import { cn } from "@/lib/utils";
import type { LeaveStatus } from "@/types";

const LABELS: Record<LeaveStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const CLASSES: Record<LeaveStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400",
  CANCELLED: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: LeaveStatus; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 w-fit shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap", CLASSES[status], className)}>
      {LABELS[status]}
    </span>
  );
}
