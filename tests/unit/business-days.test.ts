import { describe, expect, it } from "vitest";
import { calculateLeaveDays, DEFAULT_WORKING_DAYS } from "@/lib/business-days";
import type { Holiday } from "@/types";

function holiday(date: string): Holiday {
  return { id: `hol-${date}`, name: "Test Holiday", date, optional: false };
}

describe("calculateLeaveDays", () => {
  it("counts a single working day as 1", () => {
    // 2026-08-10 is a Monday.
    expect(calculateLeaveDays("2026-08-10", "2026-08-10", [])).toBe(1);
  });

  it("excludes weekends from a Mon–Fri working week", () => {
    // 2026-08-10 (Mon) through 2026-08-16 (Sun) — 5 working days, 2 weekend days.
    expect(calculateLeaveDays("2026-08-10", "2026-08-16", [], DEFAULT_WORKING_DAYS)).toBe(5);
  });

  it("excludes holidays that fall on working days", () => {
    // Mon–Fri, one holiday on the Wednesday.
    const days = calculateLeaveDays("2026-08-10", "2026-08-14", [holiday("2026-08-12")]);
    expect(days).toBe(4);
  });

  it("does not double-subtract a holiday that falls on a weekend", () => {
    // Holiday lands on Saturday 2026-08-15, which is already excluded as a weekend.
    const days = calculateLeaveDays("2026-08-10", "2026-08-16", [holiday("2026-08-15")]);
    expect(days).toBe(5);
  });

  it("respects a custom working-day set (e.g. Sun–Thu week)", () => {
    // Sun=0 .. Thu=4 as working days, Fri=5/Sat=6 as weekend.
    const sunToThu = [0, 1, 2, 3, 4];
    // 2026-08-09 (Sun) through 2026-08-15 (Sat): 5 working days.
    expect(calculateLeaveDays("2026-08-09", "2026-08-15", [], sunToThu)).toBe(5);
  });

  it("returns 0 when the range has no working days at all", () => {
    // A single weekend day.
    expect(calculateLeaveDays("2026-08-15", "2026-08-15", [], DEFAULT_WORKING_DAYS)).toBe(0);
  });

  it("returns 0 when the start date is after the end date", () => {
    expect(calculateLeaveDays("2026-08-14", "2026-08-10", [])).toBe(0);
  });

  it("counts a multi-week range spanning several weekends and a holiday", () => {
    // 2026-08-10 (Mon) through 2026-08-21 (Fri): 10 weekdays, minus 1 holiday.
    const days = calculateLeaveDays("2026-08-10", "2026-08-21", [holiday("2026-08-19")]);
    expect(days).toBe(9);
  });
});
