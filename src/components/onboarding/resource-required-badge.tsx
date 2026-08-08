import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Required/Optional is always shown (never conditionally omitted) so cards stay visually consistent. */
export function ResourceRequiredBadge({ isRequired, className }: { isRequired: boolean; className?: string }) {
  if (!isRequired) {
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", className)}>
        Optional
      </Badge>
    );
  }
  return <Badge className={cn("bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400", className)}>Required</Badge>;
}
