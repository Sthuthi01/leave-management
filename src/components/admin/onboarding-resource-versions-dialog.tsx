"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { OnboardingResource, OnboardingResourceVersion } from "@/types";
import { ResourceCategoryBadge } from "@/components/onboarding/resource-category-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { HistoryIcon } from "lucide-react";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function OnboardingResourceVersionsDialog({
  open,
  onOpenChange,
  resource,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: OnboardingResource | null;
}) {
  const { data: versions, isPending } = useQuery({
    queryKey: ["onboarding-resource-versions", resource?.id],
    queryFn: () => api.get<OnboardingResourceVersion[]>(`/onboarding/resources/${resource!.id}/versions`),
    enabled: open && !!resource,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>{resource?.title}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {resource && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="mb-1 flex items-center gap-2">
                <Badge>Current — v{resource.version}</Badge>
                <ResourceCategoryBadge category={resource.category} />
              </div>
              <p className="text-sm font-medium">{resource.title}</p>
              <p className="text-xs text-muted-foreground">{resource.description}</p>
            </div>
          )}

          {isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !versions || versions.length === 0 ? (
            <EmptyState icon={HistoryIcon} title="No earlier versions" description="This resource hasn't been edited since it was created." />
          ) : (
            versions.map((v) => (
              <div key={v.version} className="rounded-lg border border-border p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">v{v.version}</Badge>
                  <ResourceCategoryBadge category={v.category} />
                  <span className="text-xs text-muted-foreground">
                    Edited by {v.editedByName} · {formatDateTime(v.editedAt)}
                  </span>
                </div>
                <p className="text-sm font-medium">{v.title}</p>
                <p className="text-xs text-muted-foreground">{v.description}</p>
                {v.content && <p className="mt-2 line-clamp-3 text-xs whitespace-pre-line text-muted-foreground">{v.content}</p>}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
