import { useState } from "react";
import { Button, DatePicker, Empty, Form, Input, Modal, Select, Table, Tag, Typography, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { api, ApiError } from "../lib/api-client";
import type { Department, LeaveRequest, LeaveStatus, LeaveType } from "../types";

const STATUS_COLORS: Record<LeaveStatus, string> = {
  PENDING: "gold",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "default",
};

const STATUS_OPTIONS: { value: LeaveStatus | "ALL"; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "ALL", label: "All" },
];

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LeaveStatus | "ALL">("PENDING");
  const [search, setSearch] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [deciding, setDeciding] = useState<{ record: LeaveRequest; decision: "APPROVED" | "REJECTED" } | null>(null);
  const [form] = Form.useForm<{ comment?: string }>();

  const requests = useQuery({
    queryKey: ["leave-requests", "approvals", status],
    queryFn: () =>
      api.get<LeaveRequest[]>(`/leave-requests/?scope=approvals${status === "ALL" ? "" : `&status=${status}`}`),
  });
  const leaveTypes = useQuery({ queryKey: ["leave-types"], queryFn: () => api.get<LeaveType[]>("/leave-types/") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api.get<Department[]>("/departments/") });

  const hasFilters = !!search || leaveTypeId !== null || departmentId !== null || !!dateRange;

  const filtered = (requests.data ?? []).filter((record) => {
    if (search && !record.employee.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (leaveTypeId !== null && record.leave_type.id !== leaveTypeId) return false;
    if (departmentId !== null && record.employee.department.id !== departmentId) return false;
    if (dateRange?.[0] && dateRange[1]) {
      const from = dateRange[0].format("YYYY-MM-DD");
      const to = dateRange[1].format("YYYY-MM-DD");
      if (record.start_date > to || record.end_date < from) return false;
    }
    return true;
  });

  const resetFilters = () => {
    setSearch("");
    setLeaveTypeId(null);
    setDepartmentId(null);
    setDateRange(null);
  };

  const decide = useMutation({
    mutationFn: ({ id, decision, comment }: { id: number; decision: "APPROVED" | "REJECTED"; comment?: string }) =>
      api.post<LeaveRequest>(`/leave-requests/${id}/decide/`, { decision, comment }),
    onSuccess: (_data, variables) => {
      message.success(variables.decision === "APPROVED" ? "Leave request approved." : "Leave request rejected.");
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      closeDecideModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not decide this request."),
  });

  const closeDecideModal = () => {
    setDeciding(null);
    form.resetFields();
  };

  const openDecide = (record: LeaveRequest, decisionType: "APPROVED" | "REJECTED") => {
    setDeciding({ record, decision: decisionType });
    form.resetFields();
  };

  const handleDecide = (values: { comment?: string }) => {
    if (!deciding) return;
    decide.mutate({ id: deciding.record.id, decision: deciding.decision, comment: values.comment });
  };

  return (
    <>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>
        Approvals
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Showing {filtered.length} of {requests.data?.length ?? 0} request{(requests.data?.length ?? 0) === 1 ? "" : "s"}
      </Typography.Paragraph>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <Input.Search
          placeholder="Search by employee name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ width: 220 }}
        />
        <Select
          placeholder="Leave type"
          allowClear
          value={leaveTypeId ?? undefined}
          onChange={(v) => setLeaveTypeId(v ?? null)}
          options={(leaveTypes.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
          style={{ width: 160 }}
        />
        <Select
          placeholder="Department"
          allowClear
          value={departmentId ?? undefined}
          onChange={(v) => setDepartmentId(v ?? null)}
          options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          style={{ width: 160 }}
        />
        <DatePicker.RangePicker
          value={dateRange as [Dayjs, Dayjs] | null}
          onChange={(v) => setDateRange(v)}
          placeholder={["From", "To"]}
        />
        <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} style={{ width: 140 }} />
        {hasFilters && <Button onClick={resetFilters}>Reset filters</Button>}
      </div>

      <Table<LeaveRequest>
        rowKey="id"
        loading={requests.isLoading}
        dataSource={filtered}
        locale={{
          emptyText: hasFilters ? (
            <Empty description={<>No matching requests. Try a different name, or widen your leave type, department, or date filters. <a onClick={resetFilters}>Clear filters</a></>} />
          ) : status === "PENDING" ? (
            <Empty description="Nothing pending — you're all caught up. No leave requests are waiting on you." />
          ) : (
            <Empty description="No requests match this filter." />
          ),
        }}
        columns={[
          { title: "Reference", dataIndex: "reference_number" },
          { title: "Employee", render: (_, record) => record.employee.name },
          { title: "Department", render: (_, record) => record.employee.department.name },
          { title: "Leave Type", render: (_, record) => record.leave_type.name },
          {
            title: "Dates",
            render: (_, record) =>
              record.start_date === record.end_date
                ? dayjs(record.start_date).format("D MMM YYYY")
                : `${dayjs(record.start_date).format("D MMM YYYY")} – ${dayjs(record.end_date).format("D MMM YYYY")}`,
          },
          { title: "Days", dataIndex: "days", align: "right" },
          { title: "Reason", dataIndex: "reason", ellipsis: true },
          {
            title: "Status",
            dataIndex: "status",
            render: (value: LeaveStatus) => <Tag color={STATUS_COLORS[value]}>{value}</Tag>,
          },
          {
            title: "Actions",
            render: (_, record) =>
              record.status === "PENDING" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="small" type="primary" onClick={() => openDecide(record, "APPROVED")}>
                    Approve
                  </Button>
                  <Button size="small" danger onClick={() => openDecide(record, "REJECTED")}>
                    Reject
                  </Button>
                </div>
              ) : (
                <span style={{ color: "#999" }}>{record.approver_comment ? record.approver_comment : "—"}</span>
              ),
          },
        ]}
      />

      <Modal
        title={
          deciding
            ? `${deciding.decision === "APPROVED" ? "Approve" : "Reject"} ${deciding.record.reference_number}`
            : ""
        }
        open={deciding !== null}
        onCancel={closeDecideModal}
        onOk={() => form.submit()}
        confirmLoading={decide.isPending}
        okText={deciding?.decision === "APPROVED" ? "Approve" : "Reject"}
        okButtonProps={{ danger: deciding?.decision === "REJECTED" }}
      >
        <Form form={form} layout="vertical" onFinish={handleDecide}>
          <Form.Item
            name="comment"
            label={deciding?.decision === "APPROVED" ? "Comment (optional)" : "Reason for rejection"}
            rules={
              deciding?.decision === "REJECTED"
                ? [{ required: true, message: "A comment is required when rejecting a request." }]
                : []
            }
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
