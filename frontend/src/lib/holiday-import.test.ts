import { describe, expect, it } from "vitest";
import { validateHolidayImportRows, HOLIDAY_IMPORT_COLUMNS } from "./holiday-import";
import type { Holiday } from "../types";

const existingHoliday: Holiday = {
  id: 1,
  name: "Republic Day",
  date: "2026-01-26",
  optional: false,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

function row(overrides: Record<string, string> = {}) {
  return {
    [HOLIDAY_IMPORT_COLUMNS.name]: "Independence Day",
    [HOLIDAY_IMPORT_COLUMNS.date]: "2026-08-15",
    [HOLIDAY_IMPORT_COLUMNS.type]: "Mandatory",
    ...overrides,
  };
}

describe("validateHolidayImportRows", () => {
  it("accepts a valid mandatory row", () => {
    const [result] = validateHolidayImportRows([row()], { existingHolidays: [] });
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({ name: "Independence Day", date: "2026-08-15", optional: false });
  });

  it("accepts a valid optional row", () => {
    const [result] = validateHolidayImportRows([row({ [HOLIDAY_IMPORT_COLUMNS.type]: "Optional" })], { existingHolidays: [] });
    expect(result.data?.optional).toBe(true);
  });

  it("rejects a malformed date", () => {
    const [result] = validateHolidayImportRows([row({ [HOLIDAY_IMPORT_COLUMNS.date]: "15/08/2026" })], { existingHolidays: [] });
    expect(result.data).toBeNull();
  });

  it("rejects a calendar-impossible date (Feb 30)", () => {
    const [result] = validateHolidayImportRows([row({ [HOLIDAY_IMPORT_COLUMNS.date]: "2026-02-30" })], { existingHolidays: [] });
    expect(result.data).toBeNull();
  });

  it("rejects an unknown type label", () => {
    const [result] = validateHolidayImportRows([row({ [HOLIDAY_IMPORT_COLUMNS.type]: "Bonus" })], { existingHolidays: [] });
    expect(result.data).toBeNull();
  });

  it("rejects a date matching an existing holiday", () => {
    const [result] = validateHolidayImportRows([row({ [HOLIDAY_IMPORT_COLUMNS.date]: "2026-01-26" })], {
      existingHolidays: [existingHoliday],
    });
    expect(result.data).toBeNull();
    expect(result.errors.some((e) => e.includes("already exists"))).toBe(true);
  });

  it("rejects a duplicate date within the same file (second occurrence only)", () => {
    const rows = [row({ [HOLIDAY_IMPORT_COLUMNS.date]: "2026-12-25" }), row({ [HOLIDAY_IMPORT_COLUMNS.date]: "2026-12-25" })];
    const results = validateHolidayImportRows(rows, { existingHolidays: [] });
    expect(results[0].data).not.toBeNull();
    expect(results[1].data).toBeNull();
    expect(results[1].errors.some((e) => e.includes("Duplicate date"))).toBe(true);
  });

  it("silently skips a fully blank trailing row", () => {
    const results = validateHolidayImportRows([row(), { [HOLIDAY_IMPORT_COLUMNS.name]: "", [HOLIDAY_IMPORT_COLUMNS.date]: "" }], {
      existingHolidays: [],
    });
    expect(results).toHaveLength(1);
  });

  it("rejects a name under 2 characters", () => {
    const [result] = validateHolidayImportRows([row({ [HOLIDAY_IMPORT_COLUMNS.name]: "A" })], { existingHolidays: [] });
    expect(result.data).toBeNull();
  });
});
