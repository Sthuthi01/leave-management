import { useState } from "react";
import { Button, Empty, Popconfirm, Select, Table, Tag, Typography, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api, ApiError } from "../lib/api-client";
import type { LeaveRequest, LeaveStatus } from "../types";

const STATUS_COLORS: Record<LeaveStatus, string> = {
  PENDING: "gold",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "default",
};

// Matches the source app's StatusBadge LABELS exactly — friendly Title Case, not the raw
// backend enum value.
const STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const STATUS_OPTIONS: { value: LeaveStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
];

const CANCELLABLE: LeaveStatus[] = ["PENDING", "APPROVED"];

function fmt(date: string) {
  return dayjs(date).format("D MMM YYYY");
}

export function MyLeavesPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LeaveStatus | "ALL">("ALL");

  const requests = useQuery({
    queryKey: ["leave-requests", "mine", status],
    queryFn: () => api.get<LeaveRequest[]>(`/leave-requests/?scope=mine${status === "ALL" ? "" : `&status=${status}`}`),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => api.post<LeaveRequest>(`/leave-requests/${id}/cancel/`),
    onSuccess: (leaveRequest) => {
      message.success(`${leaveRequest.reference_number} cancelled.`);
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // Restored: the source app also invalidates leave-balances on cancel so the Apply Leave
      // page's balance cards (and any other balance display) refresh immediately instead of
      // waiting out the query's staleTime.
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not cancel this request."),
  });

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          My Leaves
        </Typography.Title>
        <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} style={{ width: 140 }} />
      </div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Every leave request you've submitted.
      </Typography.Paragraph>

      <Table<LeaveRequest>
        rowKey="id"
        loading={requests.isLoading}
        dataSource={requests.data ?? []}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <>
                  <div>No leave requests</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Nothing here yet — try a different filter or apply for leave.
                  </Typography.Text>
                </>
              }
            />
          ),
        }}
        columns={[
          { title: "Reference", dataIndex: "reference_number" },
          {
            title: "Leave Type",
            render: (_, record) => (
              // Restored: color dot matching the source app's LeaveTypeBadge.
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: record.leave_type.color,
                    flexShrink: 0,
                  }}
                />
                {record.leave_type.name}
              </span>
            ),
          },
          {
            title: "Dates",
            render: (_, record) =>
              record.start_date === record.end_date ? fmt(record.start_date) : `${fmt(record.start_date)} – ${fmt(record.end_date)}`,
          },
          { title: "Days", dataIndex: "days", align: "right" },
          { title: "Reason", dataIndex: "reason", ellipsis: true },
          {
            title: "Status",
            dataIndex: "status",
            render: (value: LeaveStatus) => <Tag color={STATUS_COLORS[value]}>{STATUS_LABELS[value]}</Tag>,
          },
          {
            title: "Approver comment",
            dataIndex: "approver_comment",
            render: (value: string | null) => value ?? "—",
          },
          {
            title: "Applied",
            dataIndex: "applied_at",
            render: (value: string) => fmt(value),
          },
          {
            title: "Actions",
            render: (_, record) =>
              CANCELLABLE.includes(record.status) ? (
                <Popconfirm
                  title="Cancel this leave request?"
                  description={
                    <>
                      {record.reference_number} — {record.leave_type.name}, {fmt(record.start_date)}
                      {record.start_date !== record.end_date ? ` – ${fmt(record.end_date)}` : ""}
                      {record.status === "APPROVED" ? ". This will refund the days back to your balance." : "."}
                    </>
                  }
                  onConfirm={() => cancel.mutate(record.id)}
                  okText="Cancel request"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" danger loading={cancel.isPending}>
                    Cancel
                  </Button>
                </Popconfirm>
              ) : (
                "—"
              ),
          },
        ]}
      />
    </>
  );
}
