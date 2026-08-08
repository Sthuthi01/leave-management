"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import { buildEmployeeExportRows } from "@/lib/employee-import";
import { ROLE_BADGE_CLASSNAMES, roleLabel, ROLE_FIELD_TOOLTIP, REPORTING_MANAGER_TOOLTIP } from "@/lib/rbac";
import type { Department, EmployeeWithRelations, OnboardingChecklist } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Pagination } from "@/components/shared/pagination";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { EmployeeFormDialog } from "@/components/admin/employee-form-dialog";
import { EmployeeImportDialog } from "@/components/admin/employee-import-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  UserPlusIcon,
  UsersIcon,
  PencilIcon,
  UserXIcon,
  UserCheckIcon,
  SearchIcon,
  DownloadIcon,
  UploadIcon,
  SendIcon,
  MoreVerticalIcon,
  KeyRoundIcon,
} from "lucide-react";

const PAGE_SIZE = 8;

const ACCOUNT_STATUS_TOOLTIP = "Invitation Pending means they haven't set a password yet. Active means they can sign in.";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function accountStatusMeta(emp: EmployeeWithRelations): { label: string; className: string } {
  if (emp.status === "INACTIVE") return { label: "Inactive", className: "text-muted-foreground" };
  if (!emp.hasPassword) return { label: "Invitation Pending", className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400" };
  return { label: "Active", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400" };
}

export function EmployeesClient() {
  const queryClient = useQueryClient();
  // Lets links like the Dashboard's department breakdown deep-link straight into a filtered view.
  const searchParams = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeWithRelations | null>(null);
  const [deactivating, setDeactivating] = useState<EmployeeWithRelations | null>(null);
  const [sendingReset, setSendingReset] = useState<EmployeeWithRelations | null>(null);
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE");
  const [page, setPage] = useState(1);

  const { data: employees, isPending } = useQuery({ queryKey: ["employees"], queryFn: () => api.get<EmployeeWithRelations[]>("/employees") });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: () => api.get<Department[]>("/departments") });
  const { data: checklists } = useQuery({ queryKey: ["onboarding-checklists"], queryFn: () => api.get<OnboardingChecklist[]>("/onboarding/checklists") });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "INACTIVE" }) => api.patch(`/employees/${id}`, { status }),
    onSuccess: (_, { status }) => {
      toast.success(status === "INACTIVE" ? "Employee deactivated." : "Employee reactivated.");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setDeactivating(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update this employee."),
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/employees/${id}/resend-invitation`),
    onSuccess: () => toast.success("Invitation resent."),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not resend the invitation."),
  });

  const sendResetMutation = useMutation({
    mutationFn: ({ id }: { id: string; email: string }) => api.post(`/employees/${id}/send-password-reset`),
    onSuccess: (_, { email }) => {
      toast.success(`Password reset link sent to ${email}.`);
      setSendingReset(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not send the password reset link."),
  });

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(emp: EmployeeWithRelations) {
    setEditing(emp);
    setDialogOpen(true);
  }

  const filtered = useMemo(() => {
    if (!employees) return [];
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (statusFilter !== "ALL" && e.status !== statusFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.department.name.toLowerCase().includes(q)
      );
    });
  }, [employees, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function updateStatusFilter(value: "ACTIVE" | "INACTIVE" | "ALL") {
    setStatusFilter(value);
    setPage(1);
  }

  const activeEmployees = employees?.filter((e) => e.status === "ACTIVE") ?? [];

  function exportEmployees(scope: "all" | "filtered") {
    const source = scope === "all" ? (employees ?? []) : filtered;
    if (source.length === 0) {
      toast.error("No employees to export.");
      return;
    }
    downloadCsv(`employees-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, buildEmployeeExportRows(source, checklists ?? []));
  }

  return (
    <>
      <PageHeader
        title="Employees"
        description="Manage the employee directory, departments, and reporting lines."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                <DownloadIcon /> Export
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportEmployees("filtered")}>Export filtered ({filtered.length})</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportEmployees("all")}>Export all ({employees?.length ?? 0})</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <UploadIcon /> Import
            </Button>
            <Button onClick={openCreate}>
              <UserPlusIcon /> Add employee
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name, email, title..." value={search} onChange={(e) => updateSearch(e.target.value)} className="pl-8" />
        </div>
        <Tabs value={statusFilter} onValueChange={(v) => updateStatusFilter(v as typeof statusFilter)}>
          <TabsList>
            <TabsTrigger value="ACTIVE">Active</TabsTrigger>
            <TabsTrigger value="INACTIVE">Inactive</TabsTrigger>
            <TabsTrigger value="ALL">All</TabsTrigger>
          </TabsList>
        </Tabs>
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
            <EmptyState icon={UsersIcon} title="No employees found" description="Try a different search or filter." />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Reporting Manager
                          <InfoTooltip text={REPORTING_MANAGER_TOOLTIP} />
                        </span>
                      </TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Role
                          <InfoTooltip text={ROLE_FIELD_TOOLTIP} />
                        </span>
                      </TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Account
                          <InfoTooltip text={ACCOUNT_STATUS_TOOLTIP} />
                        </span>
                      </TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.map((emp) => {
                      const accountStatus = accountStatusMeta(emp);
                      const isPending = emp.status === "ACTIVE" && !emp.hasPassword;
                      return (
                        <TableRow key={emp.id} className={emp.status === "INACTIVE" ? "opacity-60" : undefined}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-8">
                                <AvatarFallback className="bg-muted text-xs font-medium">{initials(emp.name)}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="font-medium">{emp.name}</div>
                                <div className="text-xs text-muted-foreground">{emp.title}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{emp.department.name}</TableCell>
                          <TableCell className="text-muted-foreground">{emp.manager?.name ?? "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={emp.role === "ADMIN" ? "default" : "secondary"}
                              className={cn(ROLE_BADGE_CLASSNAMES[emp.role])}
                            >
                              {roleLabel(emp.role)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={emp.status === "INACTIVE" ? "outline" : "default"} className={accountStatus.className}>
                              {accountStatus.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {isPending && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Resend invitation"
                                  onClick={() => resendMutation.mutate(emp.id)}
                                  disabled={resendMutation.isPending}
                                >
                                  <SendIcon />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => openEdit(emp)}>
                                <PencilIcon />
                              </Button>
                              {emp.status === "ACTIVE" ? (
                                <Button variant="ghost" size="icon-sm" aria-label="Deactivate" onClick={() => setDeactivating(emp)}>
                                  <UserXIcon />
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Reactivate"
                                  onClick={() => statusMutation.mutate({ id: emp.id, status: "ACTIVE" })}
                                  disabled={statusMutation.isPending}
                                >
                                  <UserCheckIcon />
                                </Button>
                              )}
                              {emp.status === "ACTIVE" && emp.hasPassword && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}
                                  >
                                    <MoreVerticalIcon />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => setSendingReset(emp)}>
                                      <KeyRoundIcon /> Send password reset link
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} totalItems={filtered.length} />
            </div>
          )}
        </CardContent>
      </Card>

      <EmployeeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employee={editing}
        departments={departments ?? []}
        managers={activeEmployees}
      />

      <EmployeeImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        departments={departments ?? []}
        employees={employees ?? []}
        checklists={checklists ?? []}
      />

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(v) => !v && setDeactivating(null)}
        title="Deactivate employee?"
        description={
          <>
            {deactivating?.name} will no longer be able to sign in or appear as a manager option. Their leave history is kept, and you can reactivate them anytime.
          </>
        }
        confirmLabel="Deactivate"
        variant="destructive"
        pending={statusMutation.isPending}
        onConfirm={() => deactivating && statusMutation.mutate({ id: deactivating.id, status: "INACTIVE" })}
      />

      <ConfirmDialog
        open={sendingReset !== null}
        onOpenChange={(v) => !v && setSendingReset(null)}
        title="Send password reset link?"
        description={<>Send a password reset link to {sendingReset?.email}? They&apos;ll be able to set a new password from the link in that email.</>}
        confirmLabel="Send link"
        pending={sendResetMutation.isPending}
        onConfirm={() => sendingReset && sendResetMutation.mutate({ id: sendingReset.id, email: sendingReset.email })}
      />
    </>
  );
}
