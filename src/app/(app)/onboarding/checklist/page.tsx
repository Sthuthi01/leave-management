"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resourceVisibleToEmployee } from "@/lib/onboarding";
import { resourceContentTypeMeta } from "@/components/onboarding/resource-type-indicator";
import type { MyOnboardingChecklist, OnboardingResource, OnboardingTaskWithProgress } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ResourceCategoryBadge } from "@/components/onboarding/resource-category-badge";
import { ResourceRequiredBadge } from "@/components/onboarding/resource-required-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckIcon,
  ClipboardListIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PartyPopperIcon,
  PaperclipIcon,
  FileTextIcon,
  DownloadIcon,
  BookOpenIcon,
} from "lucide-react";

function TaskRow({
  task,
  onToggle,
  pending,
}: {
  task: OnboardingTaskWithProgress;
  onToggle: (completed: boolean) => void;
  pending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const typeMeta = task.resource ? resourceContentTypeMeta(task.resource) : null;
  const TypeIcon = typeMeta?.icon ?? BookOpenIcon;

  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-0">
      <div className="flex items-start gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => onToggle(!task.completed)}
          aria-pressed={task.completed}
          aria-label={task.completed ? `Mark "${task.title}" incomplete` : `Mark "${task.title}" complete`}
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            task.completed ? "border-primary bg-primary text-primary-foreground" : "border-input hover:border-primary"
          )}
        >
          {task.completed && <CheckIcon className="size-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("text-sm font-medium", task.completed && "text-muted-foreground line-through")}>{task.title}</p>
            {task.completed && (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckIcon className="size-3" /> Done
              </span>
            )}
          </div>
          {task.description && <p className="text-xs text-muted-foreground">{task.description}</p>}
          {task.resource && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <TypeIcon className="size-3" /> {expanded ? "Hide" : "View"} {task.resource.title}
            </button>
          )}
        </div>
      </div>

      {expanded && task.resource && (
        <div className="ml-8 rounded-lg border border-border bg-muted/40 p-3">
          {task.resource.document && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                <FileTextIcon className="size-4 shrink-0 text-primary" />
                <span className="truncate">{task.resource.document.fileName}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<a href={`/api/onboarding/resources/${task.resource.id}/document`} target="_blank" rel="noreferrer" />}
              >
                <DownloadIcon className="size-3.5" /> View & download
              </Button>
            </div>
          )}
          {task.resource.content && <p className="text-sm whitespace-pre-line text-muted-foreground">{task.resource.content}</p>}
          {task.resource.attachments.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {task.resource.attachments.map((a) => (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <PaperclipIcon className="size-3" /> {a.name}
                </a>
              ))}
            </div>
          )}
          {task.resource.url && (
            <a
              href={task.resource.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLinkIcon className="size-3" /> Open link
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function RequiredResourcesCard({ resources }: { resources: OnboardingResource[] }) {
  const [open, setOpen] = useState<OnboardingResource | null>(null);

  if (resources.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Required resources for you</CardTitle>
        <CardDescription>Review these before you&apos;re done with onboarding — they&apos;re not checklist steps, so there&apos;s nothing to check off.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        {resources.map((r) => {
          const typeMeta = resourceContentTypeMeta(r);
          const TypeIcon = typeMeta.icon;
          return (
            <button key={r.id} type="button" onClick={() => setOpen(r)} className="flex items-start justify-between gap-3 py-2.5 text-left first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{r.title}</p>
                  <ResourceCategoryBadge category={r.category} />
                </div>
                <p className="line-clamp-1 text-xs text-muted-foreground">{r.description}</p>
                <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <TypeIcon className="size-3 shrink-0" /> {typeMeta.label}
                  {r.attachments.length > 0 && (
                    <span className="flex items-center gap-0.5">
                      <PaperclipIcon className="size-3" /> {r.attachments.length}
                    </span>
                  )}
                </span>
              </div>
              <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary">
                {typeMeta.action}
                <ChevronRightIcon className="size-3.5" />
              </span>
            </button>
          );
        })}
      </CardContent>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{open?.title}</DialogTitle>
            {open && (
              <div className="flex items-center gap-2">
                <ResourceCategoryBadge category={open.category} />
                <ResourceRequiredBadge isRequired={open.isRequired} />
              </div>
            )}
            {open?.description && <DialogDescription>{open.description}</DialogDescription>}
          </DialogHeader>
          {open?.document && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <FileTextIcon className="size-4 shrink-0 text-primary" />
                <span className="truncate">{open.document.fileName}</span>
              </span>
              <Button
                size="sm"
                nativeButton={false}
                render={<a href={`/api/onboarding/resources/${open.id}/document`} target="_blank" rel="noreferrer" />}
              >
                <DownloadIcon className="size-3.5" /> View / Download
              </Button>
            </div>
          )}
          {open?.content && <p className="text-sm whitespace-pre-line text-muted-foreground">{open.content}</p>}
          {open && open.attachments.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              {open.attachments.map((a) => (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                  <PaperclipIcon className="size-3.5" /> {a.name}
                </a>
              ))}
            </div>
          )}
          <DialogFooter>
            {open?.url && (
              <Button variant="outline" nativeButton={false} render={<a href={open.url} target="_blank" rel="noreferrer" />}>
                <ExternalLinkIcon /> Open link
              </Button>
            )}
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function MyChecklistPage() {
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const { data, isPending } = useQuery({
    queryKey: ["my-onboarding-checklist"],
    queryFn: () => api.get<MyOnboardingChecklist | null>("/onboarding/my-checklist"),
  });
  const { data: resources } = useQuery({
    queryKey: ["onboarding-resources"],
    queryFn: () => api.get<OnboardingResource[]>("/onboarding/resources"),
  });

  const requiredResources = useMemo(() => {
    if (!user || !resources) return [];
    const linkedResourceIds = new Set((data?.tasks ?? []).map((t) => t.resource?.id).filter((id): id is string => !!id));
    return resources.filter((r) => r.isRequired && !linkedResourceIds.has(r.id) && resourceVisibleToEmployee(r, user));
  }, [resources, data, user]);

  const toggleMutation = useMutation({
    mutationFn: ({ taskId, completed }: { taskId: string; completed: boolean }) => api.post(`/onboarding/tasks/${taskId}/complete`, { completed }),
    onMutate: async ({ taskId, completed }) => {
      await queryClient.cancelQueries({ queryKey: ["my-onboarding-checklist"] });
      const previous = queryClient.getQueryData<MyOnboardingChecklist | null>(["my-onboarding-checklist"]);
      queryClient.setQueryData<MyOnboardingChecklist | null>(["my-onboarding-checklist"], (old) =>
        old ? { ...old, tasks: old.tasks.map((t) => (t.id === taskId ? { ...t, completed } : t)) } : old
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context) queryClient.setQueryData(["my-onboarding-checklist"], context.previous);
      toast.error(err instanceof ApiError ? err.message : "Could not update this task.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["my-onboarding-checklist"] }),
  });

  if (isPending) {
    return (
      <>
        <PageHeader title="My Checklist" description="Track your onboarding progress and complete each step." />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="My Checklist" description="Track your onboarding progress and complete each step." />
        <div className="flex flex-col gap-4">
          <RequiredResourcesCard resources={requiredResources} />
          <Card>
            <CardContent>
              <EmptyState
                icon={ClipboardListIcon}
                title="No checklist assigned yet"
                description="HR hasn't assigned you an onboarding checklist. Check back soon, or ask your manager."
                action={
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/onboarding/resources" />}>
                    <BookOpenIcon /> Browse Resource Library
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const completedCount = data.tasks.filter((t) => t.completed).length;
  const total = data.tasks.length;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const allDone = total > 0 && completedCount === total;

  return (
    <>
      <PageHeader title="My Checklist" description="Track your onboarding progress and complete each step." />

      <div className="flex flex-col gap-4">
        <RequiredResourcesCard resources={requiredResources} />

        <Card>
          <CardHeader>
            <CardTitle>{data.checklist.name}</CardTitle>
            {data.checklist.description && <CardDescription>{data.checklist.description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {total > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Overall onboarding progress</span>
                  <span className="text-sm font-semibold text-primary">
                    {completedCount} of {total} completed
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                {requiredResources.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Plus {requiredResources.length} required resource{requiredResources.length === 1 ? "" : "s"} to review above.
                  </p>
                )}
              </div>
            )}

            {allDone && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
                <PartyPopperIcon className="size-4 shrink-0" /> You&apos;ve completed onboarding — nice work!
              </div>
            )}

            {total === 0 ? (
              <EmptyState icon={ClipboardListIcon} title="No tasks yet" description="This checklist doesn't have any steps yet. Check back once HR adds some." />
            ) : (
              <div className="flex flex-col">
                {data.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} pending={toggleMutation.isPending} onToggle={(completed) => toggleMutation.mutate({ taskId: t.id, completed })} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
