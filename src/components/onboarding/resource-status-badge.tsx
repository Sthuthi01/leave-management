import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { resourceEffectiveState } from "@/lib/onboarding";
import type { OnboardingResource } from "@/types";

const STATE_META = {
  DRAFT: { label: "Draft", className: "text-muted-foreground" },
  SCHEDULED: { label: "Scheduled", className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400" },
  LIVE: { label: "Published", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400" },
} as const;

export function ResourceStatusBadge({ resource, className }: { resource: Pick<OnboardingResource, "status" | "effectiveDate">; className?: string }) {
  const state = resourceEffectiveState(resource);
  const meta = STATE_META[state];
  const label = state === "SCHEDULED" && resource.effectiveDate ? `${meta.label} · ${resource.effectiveDate}` : meta.label;
  return <Badge variant={state === "DRAFT" ? "outline" : "default"} className={cn(meta.className, className)}>{label}</Badge>;
}
