import * as XLSX from "xlsx";
import type { Department, Employee, OnboardingChecklist, Role } from "../types";

/**
 * Column headers used by both the downloadable import template and the export file, so a
 * re-exported file (minus the read-only columns) can be re-imported without renaming anything.
 * Mirrors the source app's lib/employee-import.ts column set exactly.
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

// Matches AppLayout.tsx's ROLE_LABELS / EmployeeListPage.tsx's ROLE_OPTIONS labels — hardcoded
// locally rather than extracted to a shared module, to avoid an unrelated refactor (Phase 7
// condition: don't optimize/refactor unrelated existing code).
const ROLE_LABELS: Record<Role, string> = { EMPLOYEE: "Employee", MANAGER: "Manager", ADMIN: "HR Admin" };

// Import rows resolve names -> Django primary keys client-side (department name -> id, manager
// email -> id, checklist name -> id) so the backend never needs to parse a raw file or do name
// resolution — it only re-validates these already-resolved IDs (see accounts/views.py
// EmployeeImportView, which reuses EmployeeCreateSerializer per row).
export interface ParsedEmployeeRow {
  name: string;
  email: string;
  title: string;
  department: number;
  manager: number | null;
  role: Role;
  onboarding_checklist: number | null;
}

export interface EmployeeImportRowResult {
  /** 1-based spreadsheet row number (header row is row 1), for messages that match what the admin sees in Excel. */
  rowNumber: number;
  raw: Record<string, string>;
  errors: string[];
  data: ParsedEmployeeRow | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  context: { departments: Department[]; employees: Employee[]; checklists: OnboardingChecklist[] }
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

    if (nameRaw.length < 2) errors.push("Name must be at least 2 characters.");

    const emailValid = EMAIL_RE.test(emailRaw);
    if (!emailValid) errors.push("Not a valid email address.");

    if (titleRaw.length < 2) errors.push("Job title must be at least 2 characters.");

    let departmentId: number | null = null;
    if (!departmentRaw) {
      errors.push("Department is required.");
    } else {
      departmentId = departmentIdByName.get(departmentRaw.toLowerCase()) ?? null;
      if (departmentId === null) errors.push(`Unknown department "${departmentRaw}".`);
    }

    let role: Role = "EMPLOYEE";
    if (roleRaw) {
      const match = roleByLabel.get(roleRaw.toLowerCase());
      if (!match) errors.push(`Unknown role "${roleRaw}". Use Employee, Manager, or HR Admin.`);
      else role = match;
    }

    let managerId: number | null = null;
    if (managerEmailRaw) {
      if (emailValid && managerEmailRaw === emailRaw) {
        errors.push("An employee cannot be their own manager.");
      } else {
        managerId = activeManagerIdByEmail.get(managerEmailRaw) ?? null;
        if (managerId === null) errors.push(`Reporting manager "${managerEmailRaw}" not found among active employees.`);
      }
    }

    let onboardingChecklistId: number | null = null;
    if (checklistRaw) {
      onboardingChecklistId = checklistIdByName.get(checklistRaw.toLowerCase()) ?? null;
      if (onboardingChecklistId === null) errors.push(`Unknown onboarding checklist "${checklistRaw}".`);
    }

    if (emailValid) {
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
        ? { name: nameRaw, email: emailRaw, title: titleRaw, department: departmentId!, manager: managerId, role, onboarding_checklist: onboardingChecklistId }
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

/**
 * Mirrors the import template's columns so an exported file can be edited and re-imported.
 * `allEmployees` resolves manager id -> email client-side (the read serializer only exposes
 * manager_name, not manager_email — resolving here avoids widening that API contract just for
 * export) — pass the same full employee list export is scoped from (or the unfiltered list, when
 * exporting a filtered subset, so a manager outside the filter still resolves correctly).
 */
export function buildEmployeeExportRows(employees: Employee[], allEmployees: Employee[]): Record<string, string>[] {
  const emailById = new Map(allEmployees.map((e) => [e.id, e.email]));
  return employees.map((e) => ({
    [EMPLOYEE_IMPORT_COLUMNS.name]: e.name,
    [EMPLOYEE_IMPORT_COLUMNS.email]: e.email,
    [EMPLOYEE_IMPORT_COLUMNS.title]: e.title,
    [EMPLOYEE_IMPORT_COLUMNS.department]: e.department.name,
    [EMPLOYEE_IMPORT_COLUMNS.managerEmail]: (e.manager !== null ? emailById.get(e.manager) : null) ?? "",
    [EMPLOYEE_IMPORT_COLUMNS.role]: ROLE_LABELS[e.role],
    [EMPLOYEE_IMPORT_COLUMNS.checklist]: e.onboarding_checklist_name ?? "",
    Status: e.status === "ACTIVE" ? "Active" : "Inactive",
    "Joined Date": e.joined_at,
  }));
}
