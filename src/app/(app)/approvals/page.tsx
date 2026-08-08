"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Department, LeaveRequestWithRelations, LeaveStatus } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/leave/status-badge";
import { LeaveTypeBadge, LeaveTypeDot } from "@/components/leave/leave-type-badge";
import { DecisionDialog } from "@/components/approvals/decision-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheckIcon, RotateCcwIcon, SearchIcon } from "lucide-react";

const TABS: { key: LeaveStatus | "ALL"; label: string }[] = [
  { key: "PENDING", label: "Pending" },
  { key: "ALL", label: "All" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
];

function fmt(date: string) {
  return format(parseISO(date), "d MMM yyyy");
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState<LeaveStatus | "ALL">("PENDING");
  const [search, setSearch] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("all");
  const [departmentId, setDepartmentId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: requests, isPending } = useQuery({
    queryKey: ["leave-requests", "approvals"],
    queryFn: () => api.get<LeaveRequestWithRelations[]>("/leave-requests?scope=approvals"),
  });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: () => api.get<Department[]>("/departments") });

  // Options are derived from the requests actually in this manager's queue, so the filters never offer
  // a leave type or department that would just produce an empty result.
  const leaveTypeOptions = useMemo(() => {
    const byId = new Map((requests ?? []).map((r) => [r.leaveType.id, r.leaveType]));
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [requests]);

  const departmentOptions = useMemo(() => {
    const ids = new Set((requests ?? []).map((r) => r.employee.departmentId));
    return (departments ?? []).filter((d) => ids.has(d.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [requests, departments]);

  const isFiltered = search.trim() !== "" || leaveTypeId !== "all" || departmentId !== "all" || dateFrom !== "" || dateTo !== "";

  const statusFiltered = useMemo(() => (requests ?? []).filter((r) => tab === "ALL" || r.status === tab), [requests, tab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return statusFiltered.filter((r) => {
      if (q && !r.employee.name.toLowerCase().includes(q)) return false;
      if (leaveTypeId !== "all" && r.leaveTypeId !== leaveTypeId) return false;
      if (departmentId !== "all" && r.employee.departmentId !== departmentId) return false;
      if (dateFrom && r.endDate < dateFrom) return false;
      if (dateTo && r.startDate > dateTo) return false;
      return true;
    });
  }, [statusFiltered, search, leaveTypeId, departmentId, dateFrom, dateTo]);

  const pendingCount = requests?.filter((r) => r.status === "PENDING").length ?? 0;

  function resetFilters() {
    setSearch("");
    setLeaveTypeId("all");
    setDepartmentId("all");
    setDateFrom("");
    setDateTo("");
  }

  return (
    <>
      <PageHeader title="My Approvals" description="Leave requests from people who report to you." />

      <Tabs value={tab} onValueChange={(v) => setTab(v as LeaveStatus | "ALL")} className="mb-4">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label} {t.key === "PENDING" && pendingCount > 0 && `(${pendingCount})`}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card size="sm" className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor="approvals-search">Search</Label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="approvals-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by employee name…"
                className="pl-8"
              />
            </div>
          </div>

          <div className="flex min-w-36 flex-col gap-1.5">
            <Label htmlFor="approvals-type">Leave type</Label>
            <Select
              value={leaveTypeId}
              onValueChange={(v) => setLeaveTypeId(v ?? "all")}
              items={[{ value: "all", label: "All types" }, ...leaveTypeOptions.map((t) => ({ value: t.id, label: t.name }))]}
            >
              <SelectTrigger id="approvals-type" className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {leaveTypeOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <LeaveTypeDot color={t.color} /> {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-36 flex-col gap-1.5">
            <Label htmlFor="approvals-dept">Department</Label>
            <Select
              value={departmentId}
              onValueChange={(v) => setDepartmentId(v ?? "all")}
              items={[{ value: "all", label: "All departments" }, ...departmentOptions.map((d) => ({ value: d.id, label: d.name }))]}
            >
              <SelectTrigger id="approvals-dept" className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departmentOptions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approvals-from">From</Label>
            <Input
              id="approvals-from"
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[9.5rem]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approvals-to">To</Label>
            <Input
              id="approvals-to"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[9.5rem]"
            />
          </div>

          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
              <RotateCcwIcon /> Reset
            </Button>
          )}
        </CardContent>
      </Card>

      {isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={ClipboardCheckIcon}
              title={isFiltered ? "No matching requests" : tab === "PENDING" ? "Nothing pending" : "No requests"}
              description={
                isFiltered
                  ? "Try a different name, or widen your leave type, department, or date filters."
                  : tab === "PENDING"
                    ? "You're all caught up — no leave requests are waiting on you."
                    : "No requests match this filter."
              }
              action={
                isFiltered ? (
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {isFiltered && (
            <p className="mb-2 text-xs text-muted-foreground">
              Showing {filtered.length} of {statusFiltered.length} request{statusFiltered.length === 1 ? "" : "s"}
            </p>
          )}
          <div className="flex flex-col gap-3">
            {filtered.map((r) => (
              <Card key={r.id}>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-muted text-xs font-medium">{initials(r.employee.name)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{r.employee.name}</div>
                        <div className="text-sm text-muted-foreground">
                          <LeaveTypeBadge leaveType={r.leaveType} /> · {fmt(r.startDate)} – {fmt(r.endDate)} · {r.days} day{r.days === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>

                  {r.reason && <p className="rounded-lg bg-muted p-2.5 text-sm text-muted-foreground">&ldquo;{r.reason}&rdquo;</p>}

                  {r.approverComment && (
                    <p className="text-xs text-muted-foreground">
                      Your note: <span className="italic">&ldquo;{r.approverComment}&rdquo;</span>
                    </p>
                  )}

                  {r.status === "PENDING" && <DecisionDialog request={r} />}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
