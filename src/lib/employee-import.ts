import * as XLSX from "xlsx";
import { z } from "zod";
import { ROLE_LABELS } from "@/lib/rbac";
import type { Department, EmployeeWithRelations, OnboardingChecklist, Role } from "@/types";

/**
 * Column headers used by both the downloadable import template and the export file, so a
 * re-exported file (minus the read-only columns) can be re-imported without renaming anything.
 */
export const EMPLOYEE_IMPORT_COLUMNS = {
  name: "Full Name",
  email: "Email",
  title: "Job Title",
  department: "Department",
  managerEmail: "Reporting Manager Email",
  role: "Role",
  checklist: "Onboarding Checklist",
} as const;

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

export interface ParsedEmployeeRow {
  name: string;
  email: string;
  title: string;
  departmentId: string;
  managerId: string | null;
  role: Role;
  onboardingChecklistId: string | null;
}

export interface EmployeeImportRowResult {
  /** 1-based spreadsheet row number (header row is row 1), for messages that match what the admin sees in Excel. */
  rowNumber: number;
  raw: Record<string, string>;
  errors: string[];
  data: ParsedEmployeeRow | null;
}

const nameSchema = z.string().trim().min(2, "Name must be at least 2 characters.");
const titleSchema = z.string().trim().min(2, "Job title must be at least 2 characters.");
const emailSchema = z.string().trim().email("Not a valid email address.");

function cell(row: Record<string, string>, key: string): string {
  return (row[key] ?? "").toString().trim();
}

function isRowEmpty(row: Record<string, string>): boolean {
  return Object.values(row).every((v) => !v || !v.toString().trim());
}

/** Reads the first sheet of a .csv/.xlsx/.xls file into header-keyed row objects. */
export async function parseEmployeeImportFile(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return rows.map((row) => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key.toString().trim()] = value === undefined || value === null ? "" : String(value).trim();
    }
    return normalized;
  });
}

/**
 * Validates and resolves every parsed row against the same reference data the Add/Edit employee
 * dialog uses (departments, active employees as manager options, onboarding checklists) — so a
 * row only passes if it would also be accepted by the single-employee form.
 */
export function validateImportRows(
  rawRows: Record<string, string>[],
  context: { departments: Department[]; employees: EmployeeWithRelations[]; checklists: OnboardingChecklist[] }
): EmployeeImportRowResult[] {
  const results: EmployeeImportRowResult[] = [];
  const seenEmails = new Map<string, number>();
  const existingEmails = new Set(context.employees.map((e) => e.email.toLowerCase()));
  const activeManagerIdByEmail = new Map(
    context.employees.filter((e) => e.status === "ACTIVE").map((e) => [e.email.toLowerCase(), e.id])
  );
  const departmentIdByName = new Map(context.departments.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const checklistIdByName = new Map(context.checklists.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const roleByLabel = new Map((Object.keys(ROLE_LABELS) as Role[]).map((role) => [ROLE_LABELS[role].toLowerCase(), role]));

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2; // header occupies row 1
    if (isRowEmpty(raw)) return; // silently skip trailing/blank rows, same as Excel usually leaves them

    const errors: string[] = [];
    const nameRaw = cell(raw, EMPLOYEE_IMPORT_COLUMNS.name);
    const emailRaw = cell(raw, EMPLOYEE_IMPORT_COLUMNS.email).toLowerCase();
    const titleRaw = cell(raw, EMPLOYEE_IMPORT_COLUMNS.title);
    const departmentRaw = cell(raw, EMPLOYEE_IMPORT_COLUMNS.department);
    const managerEmailRaw = cell(raw, EMPLOYEE_IMPORT_COLUMNS.managerEmail).toLowerCase();
    const roleRaw = cell(raw, EMPLOYEE_IMPORT_COLUMNS.role);
    const checklistRaw = cell(raw, EMPLOYEE_IMPORT_COLUMNS.checklist);

    const nameCheck = nameSchema.safeParse(nameRaw);
    if (!nameCheck.success) errors.push(nameCheck.error.issues[0].message);

    const emailCheck = emailSchema.safeParse(emailRaw);
    if (!emailCheck.success) errors.push(emailCheck.error.issues[0].message);

    const titleCheck = titleSchema.safeParse(titleRaw);
    if (!titleCheck.success) errors.push(titleCheck.error.issues[0].message);

    let departmentId: string | null = null;
    if (!departmentRaw) {
      errors.push("Department is required.");
    } else {
      departmentId = departmentIdByName.get(departmentRaw.toLowerCase()) ?? null;
      if (!departmentId) errors.push(`Unknown department "${departmentRaw}".`);
    }

    let role: Role = "EMPLOYEE";
    if (roleRaw) {
      const match = roleByLabel.get(roleRaw.toLowerCase());
      if (!match) errors.push(`Unknown role "${roleRaw}". Use Employee, Manager, or HR Admin.`);
      else role = match;
    }

    let managerId: string | null = null;
    if (managerEmailRaw) {
      if (emailCheck.success && managerEmailRaw === emailRaw) {
        errors.push("An employee cannot be their own manager.");
      } else {
        managerId = activeManagerIdByEmail.get(managerEmailRaw) ?? null;
        if (!managerId) errors.push(`Reporting manager "${managerEmailRaw}" not found among active employees.`);
      }
    }

    let onboardingChecklistId: string | null = null;
    if (checklistRaw) {
      onboardingChecklistId = checklistIdByName.get(checklistRaw.toLowerCase()) ?? null;
      if (!onboardingChecklistId) errors.push(`Unknown onboarding checklist "${checklistRaw}".`);
    }

    if (emailCheck.success) {
      if (existingEmails.has(emailRaw)) {
        errors.push("An employee with this email already exists.");
      } else if (seenEmails.has(emailRaw)) {
        errors.push(`Duplicate email in this file (first seen on row ${seenEmails.get(emailRaw)}).`);
      } else {
        seenEmails.set(emailRaw, rowNumber);
      }
    }

    const data: ParsedEmployeeRow | null =
      errors.length === 0
        ? { name: nameRaw, email: emailRaw, title: titleRaw, departmentId: departmentId!, managerId, role, onboardingChecklistId }
        : null;

    results.push({ rowNumber, raw, errors, data });
  });

  return results;
}

export function buildImportTemplateRows(sampleDepartment?: string): Record<string, string>[] {
  return [
    {
      [EMPLOYEE_IMPORT_COLUMNS.name]: "Jane Doe",
      [EMPLOYEE_IMPORT_COLUMNS.email]: "jane.doe@example.com",
      [EMPLOYEE_IMPORT_COLUMNS.title]: "Software Engineer",
      [EMPLOYEE_IMPORT_COLUMNS.department]: sampleDepartment ?? "Engineering",
      [EMPLOYEE_IMPORT_COLUMNS.managerEmail]: "",
      [EMPLOYEE_IMPORT_COLUMNS.role]: ROLE_LABELS.EMPLOYEE,
      [EMPLOYEE_IMPORT_COLUMNS.checklist]: "",
    },
  ];
}

/** Mirrors the import template's columns so an exported file can be edited and re-imported. */
export function buildEmployeeExportRows(
  employees: EmployeeWithRelations[],
  checklists: OnboardingChecklist[]
): Record<string, string>[] {
  const checklistNameById = new Map(checklists.map((c) => [c.id, c.name]));
  return employees.map((e) => ({
    [EMPLOYEE_IMPORT_COLUMNS.name]: e.name,
    [EMPLOYEE_IMPORT_COLUMNS.email]: e.email,
    [EMPLOYEE_IMPORT_COLUMNS.title]: e.title,
    [EMPLOYEE_IMPORT_COLUMNS.department]: e.department.name,
    [EMPLOYEE_IMPORT_COLUMNS.managerEmail]: e.manager?.email ?? "",
    [EMPLOYEE_IMPORT_COLUMNS.role]: ROLE_LABELS[e.role],
    [EMPLOYEE_IMPORT_COLUMNS.checklist]: e.onboardingChecklistId ? (checklistNameById.get(e.onboardingChecklistId) ?? "") : "",
    Status: e.status === "ACTIVE" ? "Active" : "Inactive",
    "Joined Date": e.joinedAt,
  }));
}
