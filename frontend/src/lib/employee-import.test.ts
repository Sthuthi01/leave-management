import { describe, expect, it } from "vitest";
import { validateImportRows, EMPLOYEE_IMPORT_COLUMNS } from "./employee-import";
import type { Department, Employee, OnboardingChecklist } from "../types";

const department: Department = { id: 1, name: "Engineering" };
const checklist: OnboardingChecklist = { id: 1, name: "New Hire Checklist", description: null, is_active: true };
const existingManager: Employee = {
  id: 5,
  name: "Existing Manager",
  email: "manager@example.com",
  avatar_url: null,
  role: "MANAGER",
  title: "Manager",
  department,
  manager: null,
  manager_name: null,
  joined_at: "2025-01-01",
  status: "ACTIVE",
  has_password: true,
  onboarding_checklist: null,
  onboarding_checklist_name: null,
};

function row(overrides: Record<string, string> = {}) {
  return {
    [EMPLOYEE_IMPORT_COLUMNS.name]: "Jane Doe",
    [EMPLOYEE_IMPORT_COLUMNS.email]: "jane@example.com",
    [EMPLOYEE_IMPORT_COLUMNS.title]: "Engineer",
    [EMPLOYEE_IMPORT_COLUMNS.department]: "Engineering",
    [EMPLOYEE_IMPORT_COLUMNS.managerEmail]: "",
    [EMPLOYEE_IMPORT_COLUMNS.role]: "",
    [EMPLOYEE_IMPORT_COLUMNS.checklist]: "",
    ...overrides,
  };
}

const context = { departments: [department], employees: [existingManager], checklists: [checklist] };

describe("validateImportRows", () => {
  it("accepts a valid row and resolves department by name to id", () => {
    const [result] = validateImportRows([row()], context);
    expect(result.errors).toEqual([]);
    expect(result.data).toMatchObject({ name: "Jane Doe", email: "jane@example.com", department: department.id });
  });

  it("rejects an unknown department by name", () => {
    const [result] = validateImportRows([row({ [EMPLOYEE_IMPORT_COLUMNS.department]: "Nonexistent" })], context);
    expect(result.data).toBeNull();
    expect(result.errors.some((e) => e.includes("Unknown department"))).toBe(true);
  });

  it("resolves manager by email among active employees", () => {
    const [result] = validateImportRows([row({ [EMPLOYEE_IMPORT_COLUMNS.managerEmail]: "manager@example.com" })], context);
    expect(result.data?.manager).toBe(existingManager.id);
  });

  it("rejects a manager email that isn't an active employee", () => {
    const [result] = validateImportRows([row({ [EMPLOYEE_IMPORT_COLUMNS.managerEmail]: "ghost@example.com" })], context);
    expect(result.data).toBeNull();
    expect(result.errors.some((e) => e.includes("not found"))).toBe(true);
  });

  it("rejects an employee listed as their own manager", () => {
    const [result] = validateImportRows(
      [row({ [EMPLOYEE_IMPORT_COLUMNS.email]: "jane@example.com", [EMPLOYEE_IMPORT_COLUMNS.managerEmail]: "jane@example.com" })],
      context
    );
    expect(result.errors).toContain("An employee cannot be their own manager.");
  });

  it("resolves a role label to the role code", () => {
    const [result] = validateImportRows([row({ [EMPLOYEE_IMPORT_COLUMNS.role]: "HR Admin" })], context);
    expect(result.data?.role).toBe("ADMIN");
  });

  it("defaults role to EMPLOYEE when omitted", () => {
    const [result] = validateImportRows([row()], context);
    expect(result.data?.role).toBe("EMPLOYEE");
  });

  it("rejects an unknown role label", () => {
    const [result] = validateImportRows([row({ [EMPLOYEE_IMPORT_COLUMNS.role]: "Superuser" })], context);
    expect(result.data).toBeNull();
  });

  it("resolves checklist by name to id", () => {
    const [result] = validateImportRows([row({ [EMPLOYEE_IMPORT_COLUMNS.checklist]: "New Hire Checklist" })], context);
    expect(result.data?.onboarding_checklist).toBe(checklist.id);
  });

  it("rejects a duplicate email against an existing employee", () => {
    const [result] = validateImportRows([row({ [EMPLOYEE_IMPORT_COLUMNS.email]: "manager@example.com" })], context);
    expect(result.errors.some((e) => e.includes("already exists"))).toBe(true);
  });

  it("rejects a duplicate email within the same file (second occurrence only)", () => {
    const rows = [row({ [EMPLOYEE_IMPORT_COLUMNS.email]: "dupe@example.com" }), row({ [EMPLOYEE_IMPORT_COLUMNS.email]: "dupe@example.com" })];
    const results = validateImportRows(rows, context);
    expect(results[0].data).not.toBeNull();
    expect(results[1].data).toBeNull();
    expect(results[1].errors.some((e) => e.includes("Duplicate email"))).toBe(true);
  });

  it("silently skips a fully blank trailing row", () => {
    const results = validateImportRows(
      [row(), { [EMPLOYEE_IMPORT_COLUMNS.name]: "", [EMPLOYEE_IMPORT_COLUMNS.email]: "" }],
      context
    );
    expect(results).toHaveLength(1);
  });

  it("rejects a name under 2 characters", () => {
    const [result] = validateImportRows([row({ [EMPLOYEE_IMPORT_COLUMNS.name]: "A" })], context);
    expect(result.data).toBeNull();
  });

  it("rejects an invalid email address", () => {
    const [result] = validateImportRows([row({ [EMPLOYEE_IMPORT_COLUMNS.email]: "not-an-email" })], context);
    expect(result.data).toBeNull();
  });
});
