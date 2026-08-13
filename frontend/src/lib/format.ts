// Rounds to 1 decimal for display and normalizes -0 to 0 — a same-instant auto-approval can
// produce a durationMs of a few negative milliseconds (decided_at captured a hair before the
// row's own applied_at timestamp), which rounds to -0 and would otherwise render as "-0.0d".
// Display-only: never changes the underlying value used for delta/percentage math.
export function formatDaysForDisplay(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return (rounded === 0 ? 0 : rounded).toFixed(1);
}
