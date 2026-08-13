import { useEffect, useState } from "react";
import { Alert, Button, Card, Col, DatePicker, Descriptions, Form, Input, Progress, Row, Select, Spin, Steps, Tag, Typography, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import dayjs, { type Dayjs } from "dayjs";
import { api, ApiError } from "../lib/api-client";
import { useCurrentUser } from "../hooks/useCurrentUser";
import type { LeaveBalance, LeavePreview, LeaveRequest, LeaveType } from "../types";

const PREVIEW_DEBOUNCE_MS = 400;

interface ApplyLeaveValues {
  leave_type: number;
  dates: [Dayjs, Dayjs];
  reason?: string;
}

// Ported from the source app's ApplyLeavePage BalanceStrip — one card per active leave type,
// showing remaining/used/total and a progress indicator, or "No annual cap" for leave types with
// no default_days_per_year (allocated stays 0). Reads the same GET /api/leave-balances/ the
// Dashboard's own balance cards already use — no backend or balance business-logic change.
function LeaveBalanceCards() {
  const balances = useQuery({
    queryKey: ["leave-balances"],
    queryFn: () => api.get<LeaveBalance[]>("/leave-balances/"),
  });

  if (!balances.isLoading && (balances.data?.length ?? 0) === 0) return null;

  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      {balances.isLoading
        ? Array.from({ length: 3 }).map((_, i) => (
            <Col key={i} xs={12} sm={8} lg={6}>
              <Card size="small" loading style={{ height: 128 }} />
            </Col>
          ))
        : balances.data!.map((b) => {
            const pct = b.allocated > 0 ? Math.min(100, Math.round((b.used / b.allocated) * 100)) : 0;
            return (
              <Col key={b.id} xs={12} sm={8} lg={6}>
                <Card size="small">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, marginBottom: 8 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <Tag color={b.leave_type.color} style={{ margin: 0 }}>
                        {b.leave_type.code}
                      </Tag>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "#8c8c8c" }}>
                        {b.leave_type.name}
                      </span>
                    </span>
                    {b.carried_forward > 0 && (
                      <Tag style={{ margin: 0, fontSize: 10 }}>+{b.carried_forward}</Tag>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{b.remaining}</span>
                    <span style={{ fontSize: 12, color: "#8c8c8c" }}>days left</span>
                  </div>

                  {b.allocated > 0 ? (
                    <>
                      <Progress percent={pct} showInfo={false} strokeColor={b.leave_type.color} size="small" />
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8c8c8c" }}>
                        <span>{b.used} used</span>
                        <span>{b.allocated} total</span>
                      </div>
                    </>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      No annual cap
                    </Typography.Text>
                  )}
                </Card>
              </Col>
            );
          })}
    </Row>
  );
}

// Summary panel shown once a leave type and full date range are selected and the preview has
// resolved. Every figure here comes from the preview response or from data already fetched for
// the form (leave type, current user) — nothing here is invented or recalculated client-side.
function ApplyLeaveSummary({
  leaveType,
  preview,
  dateRange,
  hasManager,
  managerName,
}: {
  leaveType: LeaveType;
  preview: LeavePreview;
  dateRange: [Dayjs, Dayjs];
  hasManager: boolean;
  managerName: string | null;
}) {
  const requiresApproval = leaveType.requires_approval;

  return (
    <Card size="small" style={{ marginBottom: 16 }} title="Summary">
      <Descriptions
        size="small"
        column={1}
        items={[
          { key: "type", label: "Leave type", children: `${leaveType.name} (${leaveType.code})` },
          { key: "duration", label: "Duration", children: `${preview.days} working day${preview.days === 1 ? "" : "s"}` },
          {
            key: "dates",
            label: "Dates",
            children: `${dateRange[0].format("D MMM YYYY")} – ${dateRange[1].format("D MMM YYYY")}`,
          },
          {
            key: "balance",
            label: "Balance after this request",
            children: preview.is_capped
              ? `${preview.balance_after} day${preview.balance_after === 1 ? "" : "s"}`
              : "No annual cap",
          },
          {
            key: "approver",
            label: "Approver",
            children: hasManager ? managerName ?? "—" : "No manager assigned",
          },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Approval timeline
        </Typography.Text>
        <Steps
          size="small"
          current={0}
          style={{ marginTop: 8 }}
          items={
            requiresApproval
              ? [{ title: "Submitted" }, { title: "Manager review" }, { title: "Approved" }]
              : [{ title: "Submitted" }, { title: "Approved automatically" }]
          }
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Policy
        </Typography.Text>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
          <li>{requiresApproval ? "Requires manager approval" : "Auto-approved — no manager review needed"}</li>
          {!preview.is_capped && <li>No annual cap</li>}
          {leaveType.carry_forward_limit > 0 && (
            <li>
              Up to {leaveType.carry_forward_limit} unused day{leaveType.carry_forward_limit === 1 ? "" : "s"} carry
              forward to next year
            </li>
          )}
        </ul>
      </div>
    </Card>
  );
}

export function ApplyLeavePage() {
  const [form] = Form.useForm<ApplyLeaveValues>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const hasManager = !!currentUser?.manager;

  const leaveTypes = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => api.get<LeaveType[]>("/leave-types/"),
  });
  const activeLeaveTypes = (leaveTypes.data ?? []).filter((t) => t.is_active);

  // Day-count/balance preview — debounced on leave type or date changes. Calls the backend
  // POST /leave-requests/preview/ endpoint, which shares its validation and day-count logic with
  // the real submission (see leave_requests.services.preview_leave_request), so this can never
  // show a different result than what submitting actually produces. Deliberately does not
  // reimplement any of that calculation in TypeScript.
  const watchedLeaveType = Form.useWatch("leave_type", form);
  const watchedDates = Form.useWatch("dates", form);
  const selectedLeaveType = activeLeaveTypes.find((t) => t.id === watchedLeaveType);
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const rangeStart = watchedDates?.[0]?.valueOf();
  const rangeEnd = watchedDates?.[1]?.valueOf();

  useEffect(() => {
    if (!watchedLeaveType || !watchedDates?.[0] || !watchedDates?.[1]) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      api
        .post<LeavePreview>("/leave-requests/preview/", {
          leave_type: watchedLeaveType,
          start_date: watchedDates[0].format("YYYY-MM-DD"),
          end_date: watchedDates[1].format("YYYY-MM-DD"),
        })
        .then((data) => {
          setPreview(data);
          setPreviewError(null);
        })
        .catch((err) => {
          setPreview(null);
          setPreviewError(err instanceof ApiError ? err.message : "Could not calculate leave days.");
        })
        .finally(() => setPreviewLoading(false));
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedLeaveType, rangeStart, rangeEnd]);

  const apply = useMutation({
    mutationFn: (values: ApplyLeaveValues) =>
      api.post<LeaveRequest>("/leave-requests/", {
        leave_type: values.leave_type,
        start_date: values.dates[0].format("YYYY-MM-DD"),
        end_date: values.dates[1].format("YYYY-MM-DD"),
        reason: values.reason ?? "",
      }),
    onSuccess: (leaveRequest) => {
      message.success(`Leave request ${leaveRequest.reference_number} submitted.`);
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate("/leave/my-leaves");
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not submit this leave request."),
  });

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
        Apply for Leave
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Submit a new leave request and preview its impact before you send it.
      </Typography.Paragraph>

      <LeaveBalanceCards />

      <Card style={{ maxWidth: 560 }}>
        {!hasManager && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="No manager on file — requests that need approval will fail until HR assigns you one."
          />
        )}
        {apply.isError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={apply.error instanceof ApiError ? apply.error.message : "Something went wrong."}
          />
        )}
        <Form form={form} layout="vertical" onFinish={(values) => apply.mutate(values)}>
          <Form.Item name="leave_type" label="Leave type" rules={[{ required: true, message: "Select a leave type." }]}>
            <Select
              loading={leaveTypes.isLoading}
              placeholder="Select a leave type"
              options={activeLeaveTypes.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))}
            />
          </Form.Item>
          <Form.Item
            name="dates"
            label="Dates"
            rules={[{ required: true, message: "Select a start and end date." }]}
          >
            <DatePicker.RangePicker style={{ width: "100%" }} disabledDate={(date) => date.isBefore(dayjs(), "day")} />
          </Form.Item>
          <Form.Item name="reason" label="Reason (optional)">
            <Input.TextArea rows={3} maxLength={2000} showCount />
          </Form.Item>

          {previewLoading && (
            <div style={{ marginBottom: 16, color: "#8c8c8c", fontSize: 13 }}>
              <Spin size="small" style={{ marginRight: 8 }} />
              Calculating working days…
            </div>
          )}
          {!previewLoading && previewError && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={previewError} />
          )}
          {!previewLoading && !previewError && preview && selectedLeaveType && watchedDates?.[0] && watchedDates?.[1] && (
            <>
              <ApplyLeaveSummary
                leaveType={selectedLeaveType}
                preview={preview}
                dateRange={[watchedDates[0], watchedDates[1]]}
                hasManager={hasManager}
                managerName={currentUser?.manager_name ?? null}
              />
              {preview.insufficient_balance && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={`Insufficient balance: only ${preview.remaining_balance} day(s) available for a ${preview.days}-day request.`}
                />
              )}
            </>
          )}

          <Button
            type="primary"
            htmlType="submit"
            loading={apply.isPending}
            disabled={!!preview?.insufficient_balance}
          >
            Submit request
          </Button>
        </Form>
      </Card>
    </>
  );
}
