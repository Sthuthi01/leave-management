import { useState } from "react";
import { Alert, Button, Card, Col, Empty, Form, Input, List, Modal, Popconfirm, Progress, Row, Statistic, Tag, Typography, message } from "antd";
import { Column } from "@ant-design/charts";
import { SendOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { api, ApiError } from "../lib/api-client";
import { useCurrentUser } from "../hooks/useCurrentUser";
import type { AttentionPendingApproval, DashboardData, HrDashboardData, HrLeaveRequest, LeaveStatus } from "../types";

const STATUS_COLORS: Record<LeaveStatus, string> = {
  PENDING: "gold",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "default",
};

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/dashboard/"),
  });

  if (data?.kind === "HR") {
    return <HrDashboard data={data} isLoading={isLoading} />;
  }

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Dashboard
      </Typography.Title>

      {!isLoading && !!data?.pending_approvals_count && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <>
              You have {data.pending_approvals_count} request{data.pending_approvals_count === 1 ? "" : "s"} waiting
              on your decision. <Link to="/approvals">Review now</Link>
            </>
          }
        />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          Leave balance
        </Typography.Title>
        <Link to="/leave/apply">
          <Button size="small" icon={<SendOutlined />}>
            Apply Leave
          </Button>
        </Link>
      </div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        {(data?.balances ?? []).map((balance) => (
          <Col key={balance.id} xs={24} sm={12} md={8} lg={6} style={{ marginBottom: 16 }}>
            <Card size="small" loading={isLoading}>
              <Statistic
                title={
                  <span>
                    <Tag color={balance.leave_type.color}>{balance.leave_type.code}</Tag>
                    {balance.leave_type.name}
                  </span>
                }
                value={balance.remaining}
                suffix={`/ ${balance.accrued_to_date} days`}
              />
            </Card>
          </Col>
        ))}
        {!isLoading && (data?.balances.length ?? 0) === 0 && (
          <Col span={24}>
            <Empty description="No leave types configured yet" />
          </Col>
        )}
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12} style={{ marginBottom: 16 }}>
          <Card title="Recent leave requests" size="small" loading={isLoading}>
            <List
              dataSource={data?.recent_requests ?? []}
              locale={{ emptyText: "No leave requests yet" }}
              renderItem={(request) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <>
                        {request.reference_number} <Tag color={STATUS_COLORS[request.status]}>{request.status}</Tag>
                      </>
                    }
                    description={`${request.leave_type.name} — ${dayjs(request.start_date).format("D MMM YYYY")}${
                      request.start_date === request.end_date ? "" : ` – ${dayjs(request.end_date).format("D MMM YYYY")}`
                    }`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} md={12} style={{ marginBottom: 16 }}>
          <Card title="Upcoming approved leave" size="small" loading={isLoading}>
            <List
              dataSource={data?.upcoming_leave ?? []}
              locale={{ emptyText: "No upcoming leave" }}
              renderItem={(request) => (
                <List.Item>
                  <List.Item.Meta
                    title={request.leave_type.name}
                    description={`${dayjs(request.start_date).format("D MMM YYYY")}${
                      request.start_date === request.end_date ? "" : ` – ${dayjs(request.end_date).format("D MMM YYYY")}`
                    }`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24}>
          <Card title="Upcoming holidays" size="small" loading={isLoading}>
            <List
              dataSource={data?.upcoming_holidays ?? []}
              locale={{ emptyText: "No upcoming holidays" }}
              renderItem={(holiday) => (
                <List.Item>
                  <List.Item.Meta
                    title={holiday.name}
                    description={dayjs(holiday.date).format("dddd, D MMM YYYY")}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}

function leaveDatesLabel(request: HrLeaveRequest) {
  const start = dayjs(request.start_date).format("D MMM YYYY");
  if (request.start_date === request.end_date) return start;
  return `${start} – ${dayjs(request.end_date).format("D MMM YYYY")}`;
}

function HrDashboard({ data, isLoading }: { data: HrDashboardData; isLoading: boolean }) {
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const [rejecting, setRejecting] = useState<AttentionPendingApproval | null>(null);
  const [form] = Form.useForm<{ comment: string }>();

  const utilizationChartData = data.leave_utilization.flatMap((row) => [
    { code: row.leave_type.code, kind: "Used", value: row.used },
    { code: row.leave_type.code, kind: "Remaining", value: Math.max(0, row.allocated - row.used) },
  ]);

  // Lets a manager act on a request straight from the dashboard's "Attention required" list,
  // without navigating to /approvals — only shown when the viewer is the assigned approver.
  const decide = useMutation({
    mutationFn: ({ id, decision, comment }: { id: number; decision: "APPROVED" | "REJECTED"; comment?: string }) =>
      api.post(`/leave-requests/${id}/decide/`, { decision, comment }),
    onSuccess: (_data, variables) => {
      message.success(variables.decision === "APPROVED" ? "Leave request approved." : "Leave request rejected.");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      setRejecting(null);
      form.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not decide this request."),
  });

  const handleReject = (values: { comment: string }) => {
    if (!rejecting) return;
    decide.mutate({ id: rejecting.request.id, decision: "REJECTED", comment: values.comment });
  };

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        HR Dashboard
      </Typography.Title>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6} style={{ marginBottom: 16 }}>
          <Link to="/employees">
            <Card size="small" loading={isLoading} hoverable>
              <Statistic title="Total employees" value={data.total_employees} />
            </Card>
          </Link>
        </Col>
        <Col xs={24} sm={12} md={6} style={{ marginBottom: 16 }}>
          <Link to="/leave/team-calendar">
            <Card size="small" loading={isLoading} hoverable>
              <Statistic title="On leave today" value={data.on_leave_today.length} />
            </Card>
          </Link>
        </Col>
        <Col xs={24} sm={12} md={6} style={{ marginBottom: 16 }}>
          <Link to="/leave/team-calendar">
            <Card size="small" loading={isLoading} hoverable>
              <Statistic title="On leave this week" value={data.on_leave_this_week} />
            </Card>
          </Link>
        </Col>
        <Col xs={24} sm={12} md={6} style={{ marginBottom: 16 }}>
          <Link to="/approvals">
            <Card size="small" loading={isLoading} hoverable>
              <Statistic title="Pending approvals" value={data.pending_approvals_count} />
            </Card>
          </Link>
        </Col>
      </Row>

      <Card
        title="Attention required"
        size="small"
        style={{
          marginBottom: 24,
          borderColor:
            data.attention_pending_approvals.length > 0 || data.employees_without_manager.length > 0
              ? "#faad14"
              : undefined,
        }}
        loading={isLoading}
      >
        {data.attention_pending_approvals.length === 0 && data.employees_without_manager.length === 0 ? (
          <Empty description="All clear." />
        ) : (
          <Row gutter={16}>
            {data.attention_pending_approvals.length > 0 && (
              <Col xs={24} md={12}>
                <Typography.Text strong>Pending approvals</Typography.Text>
                <List
                  dataSource={data.attention_pending_approvals}
                  renderItem={(item) => (
                    <List.Item>
                      <List.Item.Meta
                        title={`${item.request.employee.name} — ${item.request.leave_type.name}`}
                        description={
                          <>
                            {leaveDatesLabel(item.request)}
                            <div style={{ marginTop: 4 }}>
                              {item.days_until_start <= 0 ? (
                                <Tag color="red">Starts today</Tag>
                              ) : item.days_until_start <= 2 ? (
                                <Tag color="orange">Starts in {item.days_until_start}d</Tag>
                              ) : null}
                              {item.days_pending >= 1 && <Tag>Pending {item.days_pending}d</Tag>}
                            </div>
                            {item.request.approver && item.request.approver.id !== currentUser?.id ? (
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                Awaiting {item.request.approver.name}
                              </Typography.Text>
                            ) : null}
                            {item.request.approver?.id === currentUser?.id && (
                              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                                <Popconfirm
                                  title="Approve this request?"
                                  onConfirm={() => decide.mutate({ id: item.request.id, decision: "APPROVED" })}
                                  okText="Approve"
                                >
                                  <Button size="small" type="primary">
                                    Approve
                                  </Button>
                                </Popconfirm>
                                <Button size="small" danger onClick={() => setRejecting(item)}>
                                  Reject
                                </Button>
                              </div>
                            )}
                          </>
                        }
                      />
                    </List.Item>
                  )}
                />
              </Col>
            )}
            {data.employees_without_manager.length > 0 && (
              <Col xs={24} md={12}>
                <Typography.Text strong>No manager assigned</Typography.Text>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {data.employees_without_manager.map((employee) => (
                    <Tag key={employee.id}>
                      {employee.name} — {employee.title}
                    </Tag>
                  ))}
                </div>
                <Link to="/employees" style={{ display: "block", marginTop: 8 }}>
                  Fix in Employees →
                </Link>
              </Col>
            )}
          </Row>
        )}
      </Card>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12} style={{ marginBottom: 16 }}>
          <Card title="Leave utilization" size="small" loading={isLoading}>
            {utilizationChartData.length > 0 ? (
              <Column data={utilizationChartData} xField="code" yField="value" colorField="kind" stack height={240} />
            ) : (
              <Empty description="No active leave types" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12} style={{ marginBottom: 16 }}>
          <Card title="Department breakdown" size="small" loading={isLoading}>
            <List
              dataSource={data.department_stats}
              renderItem={(row) => (
                <List.Item>
                  <div style={{ width: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <Link to={`/employees?search=${encodeURIComponent(row.department.name)}`}>
                        {row.department.name}
                      </Link>
                      <span>
                        {row.on_leave_today > 0 && <Tag color="gold">{row.on_leave_today} on leave</Tag>}
                        {row.employee_count} employees
                      </span>
                    </div>
                    <Progress
                      percent={data.total_employees > 0 ? Math.round((row.employee_count / data.total_employees) * 100) : 0}
                      showInfo={false}
                      size="small"
                    />
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12} style={{ marginBottom: 16 }}>
          <Card title="Recent activity" size="small" loading={isLoading}>
            <List
              dataSource={data.recent_requests}
              locale={{ emptyText: "No leave requests yet" }}
              renderItem={(request) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <>
                        {request.employee.name} <Tag color={STATUS_COLORS[request.status]}>{request.status}</Tag>
                      </>
                    }
                    description={`${request.leave_type.name} — ${leaveDatesLabel(request)}`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} style={{ marginBottom: 16 }}>
          <Card title="Upcoming holidays" size="small" loading={isLoading}>
            <List
              dataSource={data.upcoming_holidays}
              locale={{ emptyText: "No upcoming holidays" }}
              renderItem={(holiday) => (
                <List.Item>
                  <List.Item.Meta title={holiday.name} description={dayjs(holiday.date).format("dddd, D MMM YYYY")} />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title={`Reject ${rejecting?.request.reference_number ?? ""}`}
        open={rejecting !== null}
        onCancel={() => {
          setRejecting(null);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        confirmLoading={decide.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleReject}>
          <Form.Item
            name="comment"
            label="Reason for rejection"
            rules={[{ required: true, message: "A comment is required when rejecting a request." }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
