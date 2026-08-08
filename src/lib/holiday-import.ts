import * as XLSX from "xlsx";
import { z } from "zod";
import type { Holiday } from "@/types";

/**
 * Column headers used by both the downloadable import template and the export file, so a
 * re-exported file can be edited and re-imported without renaming anything.
 */
export const HOLIDAY_IMPORT_COLUMNS = {
  name: "Holiday Name",
  date: "Date",
  type: "Type",
} as const;

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

export interface ParsedHolidayRow {
  name: string;
  date: string;
  optional: boolean;
}

export interface HolidayImportRowResult {
  /** 1-based spreadsheet row number (header row is row 1), for messages that match what the admin sees in Excel. */
  rowNumber: number;
  raw: Record<string, string>;
  errors: string[];
  data: ParsedHolidayRow | null;
}

const nameSchema = z.string().trim().min(2, "Name must be at least 2 characters.");
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function cell(row: Record<string, string>, key: string): string {
  return (row[key] ?? "").toString().trim();
}

function isRowEmpty(row: Record<string, string>): boolean {
  return Object.values(row).every((v) => !v || !v.toString().trim());
}

/** Rejects anything but a real YYYY-MM-DD date — the same format `<input type="date">` uses everywhere else in this app. */
function isValidIsoDate(raw: string): boolean {
  const match = ISO_DATE_RE.exec(raw);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
}

/**
 * Reads the first sheet of a .csv/.xlsx/.xls file into header-keyed row objects. `dateNF` forces
 * any native Excel date cell to render as YYYY-MM-DD text regardless of how the source file
 * formatted it, so the Date column parses consistently no matter which app produced the file.
 */
export async function parseHolidayImportFile(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false, dateNF: "yyyy-mm-dd" });
  return rows.map((row) => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key.toString().trim()] = value === undefined || value === null ? "" : String(value).trim();
    }
    return normalized;
  });
}

/**
 * Validates and resolves every parsed row against the same rules the Add/Edit holiday dialog and
 * its API route enforce: a real date, and no two holidays sharing a date.
 */
export function validateHolidayImportRows(rawRows: Record<string, string>[], context: { existingHolidays: Holiday[] }): HolidayImportRowResult[] {
  const results: HolidayImportRowResult[] = [];
  const seenDates = new Map<string, number>();
  const existingDateNames = new Map(context.existingHolidays.map((h) => [h.date, h.name]));

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2; // header occupies row 1
    if (isRowEmpty(raw)) return; // silently skip trailing/blank rows, same as Excel usually leaves them

    const errors: string[] = [];
    const nameRaw = cell(raw, HOLIDAY_IMPORT_COLUMNS.name);
    const dateRaw = cell(raw, HOLIDAY_IMPORT_COLUMNS.date);
    const typeRaw = cell(raw, HOLIDAY_IMPORT_COLUMNS.type);

    const nameCheck = nameSchema.safeParse(nameRaw);
    if (!nameCheck.success) errors.push(nameCheck.error.issues[0].message);

    let dateValid = false;
    if (!dateRaw) {
      errors.push("Date is required.");
    } else if (!isValidIsoDate(dateRaw)) {
      errors.push(`Date must be in YYYY-MM-DD format (e.g. 2026-01-26) — got "${dateRaw}".`);
    } else {
      dateValid = true;
    }

    let optional = false;
    if (typeRaw) {
      const normalized = typeRaw.toLowerCase();
      if (normalized === "optional") optional = true;
      else if (normalized === "mandatory") optional = false;
      else errors.push(`Unknown type "${typeRaw}". Use Mandatory or Optional.`);
    }

    if (dateValid) {
      const existingName = existingDateNames.get(dateRaw);
      if (existingName) {
        errors.push(`A holiday already exists on ${dateRaw}: "${existingName}".`);
      } else if (seenDates.has(dateRaw)) {
        errors.push(`Duplicate date in this file (first seen on row ${seenDates.get(dateRaw)}).`);
      } else {
        seenDates.set(dateRaw, rowNumber);
      }
    }

    const data: ParsedHolidayRow | null = errors.length === 0 ? { name: nameRaw, date: dateRaw, optional } : null;
    results.push({ rowNumber, raw, errors, data });
  });

  return results;
}

export function buildHolidayImportTemplateRows(): Record<string, string>[] {
  return [
    {
      [HOLIDAY_IMPORT_COLUMNS.name]: "Company Foundation Day",
      [HOLIDAY_IMPORT_COLUMNS.date]: "2026-11-01",
      [HOLIDAY_IMPORT_COLUMNS.type]: "Mandatory",
    },
  ];
}

/** Mirrors the import template's columns so an exported file can be edited and re-imported. */
export function buildHolidayExportRows(holidays: Holiday[]): Record<string, string>[] {
  return holidays.map((h) => ({
    [HOLIDAY_IMPORT_COLUMNS.name]: h.name,
    [HOLIDAY_IMPORT_COLUMNS.date]: h.date,
    [HOLIDAY_IMPORT_COLUMNS.type]: h.optional ? "Optional" : "Mandatory",
  }));
}
