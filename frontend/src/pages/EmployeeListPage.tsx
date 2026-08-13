import { useMemo, useState } from "react";
import { Alert, Button, Dropdown, Form, Input, Modal, Popconfirm, Segmented, Select, Table, Tag, Typography, message } from "antd";
import { DownloadOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api-client";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { downloadCsv } from "../lib/csv";
import { buildEmployeeExportRows } from "../lib/employee-import";
import { EmployeeImportDialog } from "../components/EmployeeImportDialog";
import type { Department, Employee, OnboardingChecklist, Role } from "../types";

const PAGE_SIZE = 8;
type StatusFilter = "ACTIVE" | "INACTIVE" | "ALL";

interface CreateEmployeeValues {
  name: string;
  email: string;
  title: string;
  department: number;
  manager: number | null;
  role: Role;
  onboarding_checklist: number | null;
}

interface EditEmployeeValues {
  name: string;
  title: string;
  department: number;
  manager: number | null;
  role: Role;
  onboarding_checklist: number | null;
}

const ROLE_COLORS: Record<Employee["role"], string> = { ADMIN: "green", MANAGER: "blue", EMPLOYEE: "default" };
const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "EMPLOYEE", label: "Employee" },
  { value: "MANAGER", label: "Manager" },
  { value: "ADMIN", label: "HR Admin" },
];

export function EmployeeListPage() {
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  // Lets links like the HR Dashboard's department breakdown deep-link straight into a filtered view.
  const [searchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [createForm] = Form.useForm<CreateEmployeeValues>();
  const [editForm] = Form.useForm<EditEmployeeValues>();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [page, setPage] = useState(1);

  const isAdmin = currentUser?.role === "ADMIN";

  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.get<Employee[]>("/employees/"),
    enabled: isAdmin,
  });

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Department[]>("/departments/"),
    enabled: createOpen || editing !== null || importOpen,
  });

  const checklists = useQuery({
    queryKey: ["onboarding-checklists"],
    queryFn: () => api.get<OnboardingChecklist[]>("/onboarding/checklists/"),
    enabled: createOpen || editing !== null || importOpen,
  });

  const createEmployee = useMutation({
    mutationFn: (values: CreateEmployeeValues) => api.post<Employee>("/employees/", values),
    onSuccess: () => {
      message.success("Employee added — an invitation email was sent.");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setCreateOpen(false);
      createForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not add employee."),
  });

  const updateEmployee = useMutation({
    mutationFn: (values: EditEmployeeValues) => api.patch<Employee>(`/employees/${editing!.id}/`, values),
    onSuccess: () => {
      message.success("Employee updated.");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setEditing(null);
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not update employee."),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: Employee["status"] }) =>
      api.patch<Employee>(`/employees/${id}/`, { status }),
    onSuccess: (_, { status }) => {
      message.success(status === "INACTIVE" ? "Employee deactivated." : "Employee reactivated.");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not update employee status."),
  });

  const resendInvitation = useMutation({
    mutationFn: (id: number) => api.post<{ detail: string }>(`/employees/${id}/resend-invitation/`),
    onSuccess: () => message.success("Invitation resent."),
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not resend invitation."),
  });

  const sendPasswordReset = useMutation({
    mutationFn: (id: number) => api.post<{ detail: string }>(`/employees/${id}/send-password-reset/`),
    onSuccess: () => message.success("Password reset link sent."),
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not send password reset."),
  });

  const openEdit = (record: Employee) => {
    setEditing(record);
    editForm.setFieldsValue({
      name: record.name,
      title: record.title,
      department: record.department.id,
      manager: record.manager,
      role: record.role,
      onboarding_checklist: record.onboarding_checklist,
    });
  };

  const managerOptions = (employees.data ?? [])
    .filter((e) => e.id !== editing?.id)
    .map((e) => ({ value: e.id, label: e.name }));

  const filtered = useMemo(() => {
    const all = employees.data ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((e) => {
      if (statusFilter !== "ALL" && e.status !== statusFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.department.name.toLowerCase().includes(q)
      );
    });
  }, [employees.data, search, statusFilter]);

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function updateStatusFilter(value: StatusFilter) {
    setStatusFilter(value);
    setPage(1);
  }

  function exportEmployees(scope: "all" | "filtered") {
    const all = employees.data ?? [];
    const source = scope === "all" ? all : filtered;
    if (source.length === 0) {
      message.error("No employees to export.");
      return;
    }
    downloadCsv(`employees-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, buildEmployeeExportRows(source, all));
  }

  const exportMenuItems: MenuProps["items"] = [
    { key: "filtered", label: `Export filtered (${filtered.length})`, onClick: () => exportEmployees("filtered") },
    { key: "all", label: `Export all (${employees.data?.length ?? 0})`, onClick: () => exportEmployees("all") },
  ];

  return (
    <>
      {!isAdmin ? (
        <Alert type="info" showIcon message="Signed in" description={`Welcome, ${currentUser?.name}. The employee directory is HR-Admin only.`} />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              Employees
            </Typography.Title>
            <div style={{ display: "flex", gap: 8 }}>
              <Dropdown menu={{ items: exportMenuItems }}>
                <Button icon={<DownloadOutlined />}>Export</Button>
              </Dropdown>
              <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
                Import
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                Add employee
              </Button>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <Input
              placeholder="Search by name, email, title..."
              prefix={<SearchOutlined />}
              style={{ maxWidth: 280 }}
              value={search}
              onChange={(e) => updateSearch(e.target.value)}
              allowClear
            />
            <Segmented
              value={statusFilter}
              onChange={(v) => updateStatusFilter(v as StatusFilter)}
              options={[
                { label: "Active", value: "ACTIVE" },
                { label: "Inactive", value: "INACTIVE" },
                { label: "All", value: "ALL" },
              ]}
            />
          </div>

          <Table<Employee>
            rowKey="id"
            loading={employees.isLoading}
            dataSource={filtered}
            pagination={{ pageSize: PAGE_SIZE, current: page, onChange: setPage, total: filtered.length }}
            columns={[
              { title: "Name", dataIndex: "name" },
              { title: "Email", dataIndex: "email" },
              { title: "Role", dataIndex: "role", render: (role: Employee["role"]) => <Tag color={ROLE_COLORS[role]}>{role}</Tag> },
              { title: "Department", dataIndex: ["department", "name"] },
              { title: "Title", dataIndex: "title" },
              { title: "Manager", dataIndex: "manager_name", render: (v: string | null) => v ?? "—" },
              { title: "Onboarding", dataIndex: "onboarding_checklist_name", render: (v: string | null) => v ?? "—" },
              {
                title: "Status",
                render: (_, record) => (
                  <>
                    {record.status === "INACTIVE" ? (
                      <Tag color="red">Deactivated</Tag>
                    ) : record.has_password ? (
                      <Tag color="green">Active</Tag>
                    ) : (
                      <Tag color="orange">Invitation Pending</Tag>
                    )}
                  </>
                ),
              },
              {
                title: "Actions",
                render: (_, record) => (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="small" onClick={() => openEdit(record)}>
                      Edit
                    </Button>
                    {record.status === "ACTIVE" && !record.has_password && (
                      <Popconfirm
                        title="Resend invitation?"
                        description={`A new invite link will be emailed to ${record.email}.`}
                        onConfirm={() => resendInvitation.mutate(record.id)}
                      >
                        <Button size="small" loading={resendInvitation.isPending}>
                          Resend Invitation
                        </Button>
                      </Popconfirm>
                    )}
                    {record.status === "ACTIVE" && record.has_password && (
                      <Popconfirm
                        title="Send password reset?"
                        description={`A reset link will be emailed to ${record.email}.`}
                        onConfirm={() => sendPasswordReset.mutate(record.id)}
                      >
                        <Button size="small" loading={sendPasswordReset.isPending}>
                          Send Password Reset
                        </Button>
                      </Popconfirm>
                    )}
                    {record.status === "ACTIVE" ? (
                      <Popconfirm
                        title="Deactivate employee?"
                        description={`${record.name} will no longer be able to sign in or appear as a manager option. Their leave history is kept, and you can reactivate them anytime.`}
                        okText="Deactivate"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => updateStatus.mutate({ id: record.id, status: "INACTIVE" })}
                      >
                        <Button size="small" danger loading={updateStatus.isPending}>
                          Deactivate
                        </Button>
                      </Popconfirm>
                    ) : (
                      <Button
                        size="small"
                        loading={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: record.id, status: "ACTIVE" })}
                      >
                        Reactivate
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </>
      )}

      <Modal
        title="Add employee"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createEmployee.isPending}
      >
        <Form form={createForm} layout="vertical" onFinish={(values) => createEmployee.mutate(values)}>
          <Form.Item name="name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="title" label="Job title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="department" label="Department" rules={[{ required: true }]}>
            <Select
              loading={departments.isLoading}
              options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
            />
          </Form.Item>
          <Form.Item name="manager" label="Manager">
            <Select allowClear loading={employees.isLoading} options={managerOptions} placeholder="No manager" />
          </Form.Item>
          <Form.Item name="role" label="Role" initialValue="EMPLOYEE" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item name="onboarding_checklist" label="Onboarding checklist">
            <Select
              allowClear
              loading={checklists.isLoading}
              options={(checklists.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="No checklist"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Edit ${editing?.name ?? ""}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        confirmLoading={updateEmployee.isPending}
      >
        <Form form={editForm} layout="vertical" onFinish={(values) => updateEmployee.mutate(values)}>
          <Form.Item name="name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="title" label="Job title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="department" label="Department" rules={[{ required: true }]}>
            <Select
              loading={departments.isLoading}
              options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
            />
          </Form.Item>
          <Form.Item name="manager" label="Manager">
            <Select allowClear loading={employees.isLoading} options={managerOptions} placeholder="No manager" />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} disabled={editing?.id === currentUser?.id} />
          </Form.Item>
          <Form.Item name="onboarding_checklist" label="Onboarding checklist">
            <Select
              allowClear
              loading={checklists.isLoading}
              options={(checklists.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="No checklist"
            />
          </Form.Item>
        </Form>
      </Modal>

      <EmployeeImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        departments={departments.data ?? []}
        employees={employees.data ?? []}
        checklists={checklists.data ?? []}
      />
    </>
  );
}
