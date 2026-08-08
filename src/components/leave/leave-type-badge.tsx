import type { LeaveType } from "@/types";

export function LeaveTypeBadge({ leaveType }: { leaveType: Pick<LeaveType, "name" | "color" | "code"> }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: leaveType.color }} aria-hidden />
      {leaveType.name}
    </span>
  );
}

export function LeaveTypeDot({ color, className }: { color: string; className?: string }) {
  return <span className={`inline-block size-2.5 shrink-0 rounded-full ${className ?? ""}`} style={{ backgroundColor: color }} aria-hidden />;
}
