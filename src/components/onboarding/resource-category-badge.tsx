import { Badge } from "@/components/ui/badge";
import type { ResourceCategory } from "@/types";

const CATEGORY_META: Record<ResourceCategory, { label: string; className: string }> = {
  GUIDE: { label: "Guide", className: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400" },
  POLICY: { label: "Policy", className: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-400" },
  TRAINING: { label: "Training", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400" },
};

export function resourceCategoryLabel(category: ResourceCategory): string {
  return CATEGORY_META[category].label;
}

export function ResourceCategoryBadge({ category, className }: { category: ResourceCategory; className?: string }) {
  return <Badge className={CATEGORY_META[category].className + (className ? ` ${className}` : "")}>{CATEGORY_META[category].label}</Badge>;
}
