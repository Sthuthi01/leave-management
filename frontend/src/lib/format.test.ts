import { describe, expect, it } from "vitest";
import { formatDaysForDisplay } from "./format";

describe("formatDaysForDisplay", () => {
  it("renders a same-instant auto-approval's tiny negative duration as 0.0, not -0.0", () => {
    // decided_at captured a few ms before applied_at's own auto_now_add timestamp — this is the
    // exact scenario that produced the "-0.0d" Avg. approval time bug.
    expect(formatDaysForDisplay(-0.0000005)).toBe("0.0");
  });

  it("renders exact zero as 0.0", () => {
    expect(formatDaysForDisplay(0)).toBe("0.0");
  });

  it("renders exact negative zero as 0.0", () => {
    expect(formatDaysForDisplay(-0)).toBe("0.0");
  });

  it("renders a normal negative duration unchanged (not clamped away)", () => {
    expect(formatDaysForDisplay(-2.3)).toBe("-2.3");
  });

  it("renders a normal positive duration unchanged", () => {
    expect(formatDaysForDisplay(3.7)).toBe("3.7");
  });

  it("rounds to 1 decimal place", () => {
    expect(formatDaysForDisplay(1.449)).toBe("1.4");
    expect(formatDaysForDisplay(1.451)).toBe("1.5");
  });
});
