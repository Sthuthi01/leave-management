"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { roleLabel } from "@/lib/rbac";
import { resourceEffectiveState } from "@/lib/onboarding";
import type {
  Department,
  OnboardingChecklist,
  OnboardingChecklistDetail,
  OnboardingEmployeeProgress,
  OnboardingResource,
  OnboardingTaskWithResource,
  ResourceEffectiveState,
} from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { OnboardingResourceFormDialog } from "@/components/admin/onboarding-resource-form-dialog";
import { OnboardingResourceVersionsDialog } from "@/components/admin/onboarding-resource-versions-dialog";
import { OnboardingChecklistFormDialog } from "@/components/admin/onboarding-checklist-form-dialog";
import { OnboardingTaskFormDialog } from "@/components/admin/onboarding-task-form-dialog";
import { RESOURCE_AUDIENCE_TOOLTIP } from "@/components/admin/onboarding-resource-form-dialog";
import { ResourceCategoryBadge } from "@/components/onboarding/resource-category-badge";
import { ResourceStatusBadge } from "@/components/onboarding/resource-status-badge";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusIcon,
  BookOpenIcon,
  PencilIcon,
  Trash2Icon,
  ClipboardListIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  LinkIcon,
  FileTextIcon,
  UsersIcon,
  SearchIcon,
  HistoryIcon,
} from "lucide-react";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function audienceLabel(resource: OnboardingResource, departments: Department[] | undefined): string {
  if (resource.audienceScope === "ALL") return "Everyone";
  if (resource.audienceScope === "DEPARTMENT") return departments?.find((d) => d.id === resource.audienceDepartmentId)?.name ?? "Department";
  return roleLabel(resource.audienceRole ?? "EMPLOYEE");
}

const STATUS_TABS: { key: ResourceEffectiveState | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "LIVE", label: "Published" },
];

function ResourcesTab() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OnboardingResource | null>(null);
  const [removing, setRemoving] = useState<OnboardingResource | null>(null);
  const [viewingVersions, setViewingVersions] = useState<OnboardingResource | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ResourceEffectiveState | "ALL">("ALL");
  const [requiredOnly, setRequiredOnly] = useState(false);

  const { data: resources, isPending } = useQuery({ queryKey: ["onboarding-resources"], queryFn: () => api.get<OnboardingResource[]>("/onboarding/resources") });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: () => api.get<Department[]>("/departments") });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (resources ?? []).filter((r) => {
      if (statusFilter !== "ALL" && resourceEffectiveState(r) !== statusFilter) return false;
      if (requiredOnly && !r.isRequired) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
    });
  }, [resources, search, statusFilter, requiredOnly]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/onboarding/resources/${id}`),
    onSuccess: () => {
      toast.success("Resource removed.");
      queryClient.invalidateQueries({ queryKey: ["onboarding-resources"] });
      setRemoving(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not remove this resource."),
  });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search resources..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <TabsList>
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={requiredOnly} onCheckedChange={setRequiredOnly} aria-label="Required only" />
            Required only
          </label>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <PlusIcon /> Add resource
        </Button>
      </div>
      <Card>
        <CardContent>
          {isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !resources || resources.length === 0 ? (
            <EmptyState icon={BookOpenIcon} title="No resources yet" description="Add your first guide, policy, or training material." />
          ) : filtered.length === 0 ? (
            <EmptyState icon={SearchIcon} title="No resources found" description="Try a different search or filter." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Audience
                        <InfoTooltip text={RESOURCE_AUDIENCE_TOOLTIP} />
                      </span>
                    </TableHead>
                    <TableHead>Required</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Status
                        <InfoTooltip text="Draft, Scheduled (publishes on its effective date), or Published." />
                      </span>
                    </TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Version
                        <InfoTooltip text="Increases each time the title, content, or link is edited." />
                      </span>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.title}</div>
                        <div className="max-w-md truncate text-xs text-muted-foreground">{r.description}</div>
                        {r.document && (
                          <a
                            href={`/api/onboarding/resources/${r.id}/document`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <FileTextIcon className="size-3" /> {r.document.fileName}
                          </a>
                        )}
                        {r.attachments.length > 0 && (
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <LinkIcon className="size-3" /> {r.attachments.length} attachment{r.attachments.length === 1 ? "" : "s"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <ResourceCategoryBadge category={r.category} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{audienceLabel(r, departments)}</TableCell>
                      <TableCell>
                        {r.isRequired ? <Badge variant="outline">Required</Badge> : <span className="text-sm text-muted-foreground">Optional</span>}
                      </TableCell>
                      <TableCell>
                        <ResourceStatusBadge resource={r} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">v{r.version}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" aria-label="Version history" onClick={() => setViewingVersions(r)}>
                            <HistoryIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Edit"
                            onClick={() => {
                              setEditing(r);
                              setDialogOpen(true);
                            }}
                          >
                            <PencilIcon />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRemoving(r)} disabled={deleteMutation.isPending}>
                            <Trash2Icon />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <OnboardingResourceFormDialog open={dialogOpen} onOpenChange={setDialogOpen} resource={editing} />
      <OnboardingResourceVersionsDialog open={viewingVersions !== null} onOpenChange={(v) => !v && setViewingVersions(null)} resource={viewingVersions} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Remove resource?"
        description={<>&ldquo;{removing?.title}&rdquo; will be permanently removed. If it&apos;s linked to any tasks, set it to Draft instead.</>}
        confirmLabel="Remove"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => removing && deleteMutation.mutate(removing.id)}
      />
    </>
  );
}

function ChecklistsTab() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checklistDialogOpen, setChecklistDialogOpen] = useState(false);
  const [editingChecklist, setEditingChecklist] = useState<OnboardingChecklist | null>(null);
  const [removingChecklist, setRemovingChecklist] = useState<OnboardingChecklist | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<OnboardingTaskWithResource | null>(null);
  const [removingTask, setRemovingTask] = useState<OnboardingTaskWithResource | null>(null);

  const { data: checklists, isPending: checklistsPending } = useQuery({
    queryKey: ["onboarding-checklists"],
    queryFn: () => api.get<OnboardingChecklist[]>("/onboarding/checklists"),
  });
  const { data: detail } = useQuery({
    queryKey: ["onboarding-checklist", selectedId],
    queryFn: () => api.get<OnboardingChecklistDetail>(`/onboarding/checklists/${selectedId}`),
    enabled: !!selectedId,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/onboarding/checklists/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-checklists"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding-checklist", selectedId] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update this checklist."),
  });

  const deleteChecklistMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/onboarding/checklists/${id}`),
    onSuccess: () => {
      toast.success("Checklist removed.");
      queryClient.invalidateQueries({ queryKey: ["onboarding-checklists"] });
      setSelectedId((current) => (current === removingChecklist?.id ? null : current));
      setRemovingChecklist(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not remove this checklist."),
  });

  const moveTaskMutation = useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: "up" | "down" }) => api.post(`/onboarding/tasks/${id}/move`, { direction }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding-checklist", selectedId] }),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/onboarding/tasks/${id}`),
    onSuccess: () => {
      toast.success("Task removed.");
      queryClient.invalidateQueries({ queryKey: ["onboarding-checklist", selectedId] });
      setRemovingTask(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not remove this task."),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card size="sm">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Checklists</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingChecklist(null);
              setChecklistDialogOpen(true);
            }}
          >
            <PlusIcon /> New
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {checklistsPending ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
          ) : !checklists || checklists.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No checklists yet.</p>
          ) : (
            checklists.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  selectedId === c.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-accent/50"
                )}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {c.name}
                  {!c.isActive && (
                    <Badge variant="outline" className="shrink-0 text-muted-foreground">
                      Inactive
                    </Badge>
                  )}
                </span>
                {c.description && <span className="truncate text-xs text-muted-foreground">{c.description}</span>}
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        {!selectedId || !detail ? (
          <CardContent>
            <EmptyState icon={ClipboardListIcon} title="Select a checklist" description="Choose a checklist on the left to manage its tasks, or create a new one." />
          </CardContent>
        ) : (
          <>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>{detail.name}</CardTitle>
                {detail.description && <CardDescription>{detail.description}</CardDescription>}
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <UsersIcon className="size-3.5" /> Assigned to {detail.assignedEmployeeCount} employee{detail.assignedEmployeeCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch checked={detail.isActive} onCheckedChange={(checked) => toggleActive.mutate({ id: detail.id, isActive: checked })} aria-label="Toggle checklist active" />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit checklist"
                  onClick={() => {
                    setEditingChecklist(detail);
                    setChecklistDialogOpen(true);
                  }}
                >
                  <PencilIcon />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Remove checklist" onClick={() => setRemovingChecklist(detail)}>
                  <Trash2Icon />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {detail.tasks.length === 0 ? (
                <EmptyState icon={ClipboardListIcon} title="No tasks yet" description="Add the first step of this checklist." />
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  {detail.tasks.map((t, i) => (
                    <div key={t.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="flex flex-col pt-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-5"
                            disabled={i === 0}
                            aria-label="Move up"
                            onClick={() => moveTaskMutation.mutate({ id: t.id, direction: "up" })}
                          >
                            <ChevronUpIcon className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-5"
                            disabled={i === detail.tasks.length - 1}
                            aria-label="Move down"
                            onClick={() => moveTaskMutation.mutate({ id: t.id, direction: "down" })}
                          >
                            <ChevronDownIcon className="size-3.5" />
                          </Button>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{t.title}</p>
                          {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                          {t.resource && (
                            <span className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
                              <LinkIcon className="size-3" /> {t.resource.title}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Edit task"
                          onClick={() => {
                            setEditingTask(t);
                            setTaskDialogOpen(true);
                          }}
                        >
                          <PencilIcon />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Remove task" onClick={() => setRemovingTask(t)}>
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingTask(null);
                    setTaskDialogOpen(true);
                  }}
                >
                  <PlusIcon /> Add task
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>

      <OnboardingChecklistFormDialog
        open={checklistDialogOpen}
        onOpenChange={setChecklistDialogOpen}
        checklist={editingChecklist}
        onCreated={(c) => setSelectedId(c.id)}
      />
      <ConfirmDialog
        open={removingChecklist !== null}
        onOpenChange={(v) => !v && setRemovingChecklist(null)}
        title="Remove checklist?"
        description={<>&ldquo;{removingChecklist?.name}&rdquo; and its tasks will be permanently removed. This can&apos;t be undone.</>}
        confirmLabel="Remove"
        variant="destructive"
        pending={deleteChecklistMutation.isPending}
        onConfirm={() => removingChecklist && deleteChecklistMutation.mutate(removingChecklist.id)}
      />

      {selectedId && <OnboardingTaskFormDialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen} checklistId={selectedId} task={editingTask} />}
      <ConfirmDialog
        open={removingTask !== null}
        onOpenChange={(v) => !v && setRemovingTask(null)}
        title="Remove task?"
        description={<>&ldquo;{removingTask?.title}&rdquo; will be permanently removed from this checklist.</>}
        confirmLabel="Remove"
        variant="destructive"
        pending={deleteTaskMutation.isPending}
        onConfirm={() => removingTask && deleteTaskMutation.mutate(removingTask.id)}
      />
    </div>
  );
}

function progressStatusLabel(p: OnboardingEmployeeProgress): string {
  if (!p.checklist) return "No checklist";
  if (p.totalTasks === 0) return "No tasks";
  if (p.completedTasks === 0) return "Not started";
  if (p.completedTasks === p.totalTasks) return "Complete";
  return "In progress";
}

function ProgressTab() {
  const [search, setSearch] = useState("");
  const { data: progress, isPending } = useQuery({
    queryKey: ["onboarding-progress"],
    queryFn: () => api.get<OnboardingEmployeeProgress[]>("/onboarding/progress"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return progress ?? [];
    return (progress ?? []).filter((p) => p.employee.name.toLowerCase().includes(q) || p.department.name.toLowerCase().includes(q));
  }, [progress, search]);

  return (
    <>
      <div className="mb-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
      </div>
      <Card>
        <CardContent>
          {isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={UsersIcon} title="No employees found" description="Try a different search." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Checklist</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const pct = p.totalTasks > 0 ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0;
                    return (
                      <TableRow key={p.employee.id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-8">
                              <AvatarFallback className="bg-muted text-xs font-medium">{initials(p.employee.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="font-medium">{p.employee.name}</div>
                              <div className="text-xs text-muted-foreground">{p.employee.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{p.department.name}</TableCell>
                        <TableCell className="text-muted-foreground">{p.checklist?.name ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {p.checklist && p.totalTasks > 0 && (
                              <>
                                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {p.completedTasks}/{p.totalTasks}
                                </span>
                              </>
                            )}
                            <Badge variant="outline" className="text-muted-foreground">
                              {progressStatusLabel(p)}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.lastActivityAt ? new Date(p.lastActivityAt).toLocaleDateString() : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export function OnboardingClient() {
  const [tab, setTab] = useState<"resources" | "checklists" | "progress">("resources");

  return (
    <>
      <PageHeader title="Onboarding Content" description="Manage the guides, policies, training materials, checklists, and progress of new hires." />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="checklists">Checklists</TabsTrigger>
          <TabsTrigger value="progress">Employee Progress</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "resources" ? <ResourcesTab /> : tab === "checklists" ? <ChecklistsTab /> : <ProgressTab />}
    </>
  );
}
