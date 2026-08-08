"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import type { LeaveRequestWithRelations, LeaveStatus } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/leave/status-badge";
import { LeaveTypeBadge } from "@/components/leave/leave-type-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ListChecksIcon, XIcon } from "lucide-react";

const TABS: { key: LeaveStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "CANCELLED", label: "Cancelled" },
];

const PAGE_SIZE = 8;

function fmt(date: string) {
  return format(parseISO(date), "d MMM yyyy");
}

export default function MyLeavesPage() {
  const [tab, setTab] = useState<LeaveStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<LeaveRequestWithRelations | null>(null);
  const queryClient = useQueryClient();

  const { data: requests, isPending } = useQuery({
    queryKey: ["leave-requests", "mine"],
    queryFn: () => api.get<LeaveRequestWithRelations[]>("/leave-requests?scope=mine"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post<LeaveRequestWithRelations>(`/leave-requests/${id}/cancel`),
    onSuccess: () => {
      toast.success("Leave request cancelled.");
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      setCancelling(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not cancel this request."),
  });

  const filtered = useMemo(() => (requests ?? []).filter((r) => tab === "ALL" || r.status === tab), [requests, tab]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function changeTab(value: LeaveStatus | "ALL") {
    setTab(value);
    setPage(1);
  }

  return (
    <>
      <PageHeader title="My Leaves" description="Every leave request you've submitted." />

      <Tabs value={tab} onValueChange={(v) => changeTab(v as LeaveStatus | "ALL")} className="mb-4">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent>
          {isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={ListChecksIcon} title="No leave requests" description="Nothing here yet — try a different filter or apply for leave." />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Applied</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.referenceNumber}</TableCell>
                        <TableCell>
                          <LeaveTypeBadge leaveType={r.leaveType} />
                        </TableCell>
                        <TableCell>
                          {fmt(r.startDate)} – {fmt(r.endDate)}
                        </TableCell>
                        <TableCell>{r.days}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{fmt(r.appliedAt)}</TableCell>
                        <TableCell className="text-right">
                          {(r.status === "PENDING" || r.status === "APPROVED") && (
                            <Button variant="ghost" size="sm" disabled={cancelMutation.isPending} onClick={() => setCancelling(r)}>
                              <XIcon /> Cancel
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} totalItems={filtered.length} />
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(v) => !v && setCancelling(null)}
        title="Cancel this leave request?"
        description={
          cancelling ? (
            <>
              {cancelling.referenceNumber} — {cancelling.leaveType.name}, {fmt(cancelling.startDate)} – {fmt(cancelling.endDate)}
              {cancelling.status === "APPROVED" ? ". This will refund the days back to your balance." : "."}
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Cancel request"
        variant="destructive"
        pending={cancelMutation.isPending}
        onConfirm={() => cancelling && cancelMutation.mutate(cancelling.id)}
      />
    </>
  );
}
