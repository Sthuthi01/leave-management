import type { Holiday } from "@/types";

export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

function toDateOnly(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Counts working days between two dates (inclusive), excluding non-working days and the given
 * holidays. `workingDays` lists which days of the week count as working (0 = Sunday ... 6 = Saturday);
 * defaults to Mon–Fri but is normally sourced from org Settings since not every org uses that week.
 */
export function calculateLeaveDays(startDate: string, endDate: string, holidays: Holiday[], workingDays: number[] = DEFAULT_WORKING_DAYS): number {
  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  if (start > end) return 0;

  const workingDaySet = new Set(workingDays);
  const holidaySet = new Set(holidays.map((h) => toDateOnly(h.date).getTime()));

  let days = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const isWorkingDay = workingDaySet.has(cursor.getUTCDay());
    const isHoliday = holidaySet.has(cursor.getTime());
    if (isWorkingDay && !isHoliday) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
