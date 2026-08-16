import { useMemo, useState } from "react";
import {
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { DeleteOutlined, DownloadOutlined, MinusCircleOutlined, PaperClipOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";
import { resourceEffectiveState } from "../lib/onboarding";
import type {
  AudienceScope,
  Department,
  OnboardingChecklist,
  OnboardingChecklistDetail,
  OnboardingEmployeeProgress,
  OnboardingResource,
  OnboardingTask,
  ResourceCategory,
  ResourceEffectiveState,
  ResourceStatus,
  ResourceVersion,
  Role,
} from "../types";

const CATEGORY_OPTIONS: { value: ResourceCategory; label: string }[] = [
  { value: "GUIDE", label: "Guide" },
  { value: "POLICY", label: "Policy" },
  { value: "TRAINING", label: "Training" },
];
const AUDIENCE_OPTIONS: { value: AudienceScope; label: string }[] = [
  { value: "ALL", label: "All employees" },
  { value: "DEPARTMENT", label: "Department" },
  { value: "ROLE", label: "Role" },
];
const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "EMPLOYEE", label: "Employee" },
  { value: "MANAGER", label: "Manager" },
  { value: "ADMIN", label: "HR Admin" },
];
const STATE_COLORS: Record<string, string> = { DRAFT: "default", SCHEDULED: "orange", LIVE: "green" };
const STATUS_TABS: { key: ResourceEffectiveState | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "LIVE", label: "Published" },
];

export function OnboardingAdminPage() {
  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Onboarding Content
      </Typography.Title>
      <Tabs
        defaultActiveKey="resources"
        items={[
          { key: "resources", label: "Resources", children: <ResourcesTab /> },
          { key: "checklists", label: "Checklists", children: <ChecklistsTab /> },
          { key: "progress", label: "Employee Progress", children: <ProgressTab /> },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Resources tab
// ---------------------------------------------------------------------------

interface ResourceFormValues {
  title: string;
  category: ResourceCategory;
  description: string;
  content: string | null;
  url: string | null;
  status: ResourceStatus;
  is_required: boolean;
  audience_scope: AudienceScope;
  audience_department: number | null;
  audience_role: Role | null;
  effective_date: string | null;
  attachments: { name: string; url: string }[];
}

const RESOURCE_DEFAULTS: ResourceFormValues = {
  title: "",
  category: "GUIDE",
  description: "",
  content: "",
  url: "",
  status: "DRAFT",
  is_required: false,
  audience_scope: "ALL",
  audience_department: null,
  audience_role: null,
  effective_date: "",
  attachments: [],
};

function ResourcesTab() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OnboardingResource | null>(null);
  const [documentTarget, setDocumentTarget] = useState<OnboardingResource | null>(null);
  const [versionsTarget, setVersionsTarget] = useState<OnboardingResource | null>(null);
  const [form] = Form.useForm<ResourceFormValues>();
  const audienceScope = Form.useWatch("audience_scope", form);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ResourceEffectiveState | "ALL">("ALL");
  const [requiredOnly, setRequiredOnly] = useState(false);

  const resources = useQuery({ queryKey: ["onboarding-resources"], queryFn: () => api.get<OnboardingResource[]>("/onboarding/resources/") });

  const filteredResources = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (resources.data ?? []).filter((r) => {
      if (statusFilter !== "ALL" && resourceEffectiveState(r) !== statusFilter) return false;
      if (requiredOnly && !r.is_required) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
    });
  }, [resources.data, search, statusFilter, requiredOnly]);
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Department[]>("/departments/"),
    enabled: modalOpen,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["onboarding-resources"] });

  // AntD's date/text inputs submit "" for an empty optional field, but DRF's DateField/URLField
  // reject "" as an invalid format (they only accept a real value or an absent/null key) — this
  // matches the original app's own `body?.content?.trim() || null` normalization.
  const normalize = (values: ResourceFormValues): ResourceFormValues => ({
    ...values,
    content: values.content?.trim() || null,
    url: values.url?.trim() || null,
    effective_date: values.effective_date?.trim() || null,
  });

  const createResource = useMutation({
    mutationFn: (values: ResourceFormValues) => api.post<OnboardingResource>("/onboarding/resources/", normalize(values)),
    onSuccess: () => {
      message.success("Resource added.");
      invalidate();
      closeModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not add resource."),
  });

  const updateResource = useMutation({
    mutationFn: (values: ResourceFormValues) => api.patch<OnboardingResource>(`/onboarding/resources/${editing!.id}/`, normalize(values)),
    onSuccess: () => {
      message.success("Resource updated.");
      invalidate();
      closeModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not update resource."),
  });

  const deleteResource = useMutation({
    mutationFn: (id: number) => api.delete(`/onboarding/resources/${id}/`),
    onSuccess: () => {
      message.success("Resource removed.");
      invalidate();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not remove resource."),
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue(RESOURCE_DEFAULTS);
    setModalOpen(true);
  };

  const openEdit = (resource: OnboardingResource) => {
    setEditing(resource);
    form.setFieldsValue({
      title: resource.title,
      category: resource.category,
      description: resource.description,
      content: resource.content ?? "",
      url: resource.url ?? "",
      status: resource.status,
      is_required: resource.is_required,
      audience_scope: resource.audience_scope,
      audience_department: resource.audience_department,
      audience_role: resource.audience_role,
      effective_date: resource.effective_date ?? "",
      attachments: resource.attachments.map((a) => ({ name: a.name, url: a.url })),
    });
    setModalOpen(true);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Input.Search
            placeholder="Search resources..."
            allowClear
            style={{ width: 240 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            prefix={<SearchOutlined />}
          />
          <Tabs
            activeKey={statusFilter}
            onChange={(key) => setStatusFilter(key as ResourceEffectiveState | "ALL")}
            items={STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
          />
          <Space size="small">
            <Switch checked={requiredOnly} onChange={setRequiredOnly} size="small" />
            <Typography.Text type="secondary">Required only</Typography.Text>
          </Space>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add resource
        </Button>
      </div>

      <Table<OnboardingResource>
        rowKey="id"
        loading={resources.isLoading}
        dataSource={filteredResources}
        locale={{ emptyText: search || statusFilter !== "ALL" || requiredOnly ? "No resources found. Try a different search or filter." : "No resources yet." }}
        columns={[
          { title: "Title", dataIndex: "title" },
          { title: "Category", dataIndex: "category", render: (v: ResourceCategory) => <Tag>{v}</Tag> },
          {
            title: "Effective state",
            render: (_, record) => {
              const state = resourceEffectiveState(record);
              return <Tag color={STATE_COLORS[state]}>{state}</Tag>;
            },
          },
          { title: "Audience", dataIndex: "audience_scope" },
          { title: "Required", dataIndex: "is_required", render: (v: boolean) => (v ? <Tag color="red">Required</Tag> : "—") },
          { title: "Version", dataIndex: "version" },
          { title: "Document", render: (_, record) => (record.document ? <Tag color="blue">{record.document.file_name}</Tag> : "—") },
          {
            title: "Attachments",
            render: (_, record) =>
              record.attachments.length > 0 ? (
                <Tag icon={<PaperClipOutlined />}>{record.attachments.length}</Tag>
              ) : (
                "—"
              ),
          },
          {
            title: "Actions",
            render: (_, record) => (
              <Space size="small">
                <Button size="small" onClick={() => openEdit(record)}>
                  Edit
                </Button>
                <Button size="small" onClick={() => setDocumentTarget(record)}>
                  Document
                </Button>
                {record.version > 1 && (
                  <Button size="small" onClick={() => setVersionsTarget(record)}>
                    History
                  </Button>
                )}
                <Popconfirm title="Remove this resource?" onConfirm={() => deleteResource.mutate(record.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `Edit ${editing.title}` : "Add resource"}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createResource.isPending || updateResource.isPending}
        width={640}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => (editing ? updateResource.mutate(values) : createResource.mutate(values))}
        >
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            <Select options={CATEGORY_OPTIONS} />
          </Form.Item>
          <Form.Item name="description" label="Description" rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="content" label="Content (rich text body, optional)">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="url" label="External link (optional)">
            <Input placeholder="https://…" />
          </Form.Item>
          <Form.Item name="status" label="Status" rules={[{ required: true }]}>
            <Select options={[{ value: "DRAFT", label: "Draft" }, { value: "PUBLISHED", label: "Published" }]} />
          </Form.Item>
          <Form.Item name="effective_date" label="Effective date (optional — leave blank for immediately)">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="is_required" label="Required reading" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="audience_scope" label="Audience" rules={[{ required: true }]}>
            <Select options={AUDIENCE_OPTIONS} />
          </Form.Item>
          {audienceScope === "DEPARTMENT" && (
            <Form.Item name="audience_department" label="Department" rules={[{ required: true }]}>
              <Select loading={departments.isLoading} options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
            </Form.Item>
          )}
          {audienceScope === "ROLE" && (
            <Form.Item name="audience_role" label="Role" rules={[{ required: true }]}>
              <Select options={ROLE_OPTIONS} />
            </Form.Item>
          )}

          <Form.Item label="Attachments (optional)" style={{ marginBottom: 0 }}>
            <Form.List name="attachments">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }) => (
                    <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }}>
                      <Form.Item {...rest} name={[name, "name"]} noStyle>
                        <Input placeholder="Link name" style={{ width: 200 }} />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, "url"]} noStyle>
                        <Input placeholder="https://…" style={{ width: 260 }} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(name)} />
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add({ name: "", url: "" })} icon={<PlusOutlined />}>
                    Add attachment
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>

      {documentTarget && <DocumentModal resource={documentTarget} onClose={() => setDocumentTarget(null)} onChanged={invalidate} />}
      {versionsTarget && <VersionsModal resource={versionsTarget} onClose={() => setVersionsTarget(null)} />}
    </>
  );
}

function DocumentModal({ resource, onClose, onChanged }: { resource: OnboardingResource; onClose: () => void; onChanged: () => void }) {
  const upload = useMutation({
    mutationFn: (file: File) => api.upload(`/onboarding/resources/${resource.id}/document/`, file),
    onSuccess: () => {
      message.success("Document uploaded.");
      onChanged();
      onClose();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not upload document."),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/onboarding/resources/${resource.id}/document/`),
    onSuccess: () => {
      message.success("Document removed.");
      onChanged();
      onClose();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not remove document."),
  });

  const downloadUrl = `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8012/api"}/onboarding/resources/${resource.id}/document/`;

  return (
    <Modal title={`Document — ${resource.title}`} open onCancel={onClose} footer={null}>
      {resource.document ? (
        <>
          <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="File name">{resource.document.file_name}</Descriptions.Item>
            <Descriptions.Item label="Size">{(resource.document.file_size / 1024).toFixed(1)} KB</Descriptions.Item>
            <Descriptions.Item label="Uploaded">{new Date(resource.document.uploaded_at).toLocaleString()}</Descriptions.Item>
          </Descriptions>
          <Space>
            <Button icon={<DownloadOutlined />} href={downloadUrl} target="_blank" rel="noreferrer">
              Download
            </Button>
            <Popconfirm title="Remove this document?" onConfirm={() => remove.mutate()}>
              <Button danger loading={remove.isPending}>
                Remove
              </Button>
            </Popconfirm>
          </Space>
        </>
      ) : (
        <Typography.Paragraph type="secondary">No document uploaded yet.</Typography.Paragraph>
      )}
      <Upload
        showUploadList={false}
        beforeUpload={(file) => {
          upload.mutate(file);
          return false;
        }}
      >
        <Button icon={<UploadOutlined />} loading={upload.isPending} style={{ marginTop: 16 }}>
          {resource.document ? "Replace document" : "Upload document"}
        </Button>
      </Upload>
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
        PDF, Word, PowerPoint, Excel, text, or image — up to 10MB.
      </Typography.Paragraph>
    </Modal>
  );
}

function VersionsModal({ resource, onClose }: { resource: OnboardingResource; onClose: () => void }) {
  const versions = useQuery({
    queryKey: ["onboarding-resource-versions", resource.id],
    queryFn: () => api.get<ResourceVersion[]>(`/onboarding/resources/${resource.id}/versions/`),
  });

  return (
    <Modal title={`Version history — ${resource.title}`} open onCancel={onClose} footer={null} width={600}>
      <Table<ResourceVersion>
        rowKey="version"
        size="small"
        loading={versions.isLoading}
        dataSource={versions.data ?? []}
        pagination={false}
        columns={[
          { title: "Version", dataIndex: "version" },
          { title: "Title", dataIndex: "title" },
          { title: "Edited", dataIndex: "edited_at", render: (v: string) => new Date(v).toLocaleString() },
          { title: "By", dataIndex: "edited_by_name" },
        ]}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Checklists tab
// ---------------------------------------------------------------------------

function ChecklistsTab() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OnboardingChecklist | null>(null);
  const [tasksTarget, setTasksTarget] = useState<OnboardingChecklist | null>(null);
  const [form] = Form.useForm<{ name: string; description: string | null; is_active: boolean }>();

  const checklists = useQuery({ queryKey: ["onboarding-checklists"], queryFn: () => api.get<OnboardingChecklist[]>("/onboarding/checklists/") });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["onboarding-checklists"] });

  const createChecklist = useMutation({
    mutationFn: (values: { name: string; description: string | null }) => api.post<OnboardingChecklist>("/onboarding/checklists/", values),
    onSuccess: () => {
      message.success("Checklist created.");
      invalidate();
      closeModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not create checklist."),
  });

  const updateChecklist = useMutation({
    mutationFn: (values: { name: string; description: string | null; is_active: boolean }) =>
      api.patch(`/onboarding/checklists/${editing!.id}/`, values),
    onSuccess: () => {
      message.success("Checklist updated.");
      invalidate();
      closeModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not update checklist."),
  });

  const deleteChecklist = useMutation({
    mutationFn: (id: number) => api.delete(`/onboarding/checklists/${id}/`),
    onSuccess: () => {
      message.success("Checklist removed.");
      invalidate();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not remove checklist."),
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ name: "", description: "", is_active: true });
    setModalOpen(true);
  };

  const openEdit = (checklist: OnboardingChecklist) => {
    setEditing(checklist);
    form.setFieldsValue({ name: checklist.name, description: checklist.description ?? "", is_active: checklist.is_active });
    setModalOpen(true);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add checklist
        </Button>
      </div>

      <Table<OnboardingChecklist>
        rowKey="id"
        loading={checklists.isLoading}
        dataSource={checklists.data ?? []}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Description", dataIndex: "description", render: (v: string | null) => v ?? "—" },
          { title: "Active", dataIndex: "is_active", render: (v: boolean) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          {
            title: "Actions",
            render: (_, record) => (
              <Space size="small">
                <Button size="small" onClick={() => setTasksTarget(record)}>
                  Manage tasks
                </Button>
                <Button size="small" onClick={() => openEdit(record)}>
                  Edit
                </Button>
                <Popconfirm title="Remove this checklist?" onConfirm={() => deleteChecklist.mutate(record.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `Edit ${editing.name}` : "Add checklist"}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createChecklist.isPending || updateChecklist.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => (editing ? updateChecklist.mutate(values) : createChecklist.mutate(values))}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          {editing && (
            <Form.Item name="is_active" label="Active" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {tasksTarget && <TasksDrawer checklist={tasksTarget} onClose={() => setTasksTarget(null)} />}
    </>
  );
}

function TasksDrawer({ checklist, onClose }: { checklist: OnboardingChecklist; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<OnboardingTask | null>(null);
  const [form] = Form.useForm<{ title: string; description: string | null; resource: number | null }>();

  const detail = useQuery({
    queryKey: ["onboarding-checklist-detail", checklist.id],
    queryFn: () => api.get<OnboardingChecklistDetail>(`/onboarding/checklists/${checklist.id}/`),
  });
  const resources = useQuery({ queryKey: ["onboarding-resources"], queryFn: () => api.get<OnboardingResource[]>("/onboarding/resources/") });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["onboarding-checklist-detail", checklist.id] });

  const createTask = useMutation({
    mutationFn: (values: { title: string; description: string | null; resource: number | null }) =>
      api.post(`/onboarding/checklists/${checklist.id}/tasks/`, values),
    onSuccess: () => {
      message.success("Task added.");
      invalidate();
      closeTaskModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not add task."),
  });

  const updateTask = useMutation({
    mutationFn: (values: { title: string; description: string | null; resource: number | null }) =>
      api.patch(`/onboarding/tasks/${editingTask!.id}/`, values),
    onSuccess: () => {
      message.success("Task updated.");
      invalidate();
      closeTaskModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not update task."),
  });

  const deleteTask = useMutation({
    mutationFn: (id: number) => api.delete(`/onboarding/tasks/${id}/`),
    onSuccess: () => {
      message.success("Task removed.");
      invalidate();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not remove task."),
  });

  const moveTask = useMutation({
    mutationFn: ({ id, direction }: { id: number; direction: "up" | "down" }) =>
      api.post(`/onboarding/tasks/${id}/move/`, { direction }),
    onSuccess: invalidate,
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not reorder task."),
  });

  const closeTaskModal = () => {
    setTaskModalOpen(false);
    setEditingTask(null);
    form.resetFields();
  };

  const openCreateTask = () => {
    setEditingTask(null);
    form.setFieldsValue({ title: "", description: "", resource: null });
    setTaskModalOpen(true);
  };

  const openEditTask = (task: OnboardingTask) => {
    setEditingTask(task);
    form.setFieldsValue({ title: task.title, description: task.description ?? "", resource: task.resource?.id ?? null });
    setTaskModalOpen(true);
  };

  const tasks = detail.data?.tasks ?? [];

  return (
    <Drawer title={`Tasks — ${checklist.name}`} open onClose={onClose} width={520}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Typography.Text type="secondary">
          Assigned to {detail.data?.assigned_employee_count ?? 0} employee{detail.data?.assigned_employee_count === 1 ? "" : "s"}
        </Typography.Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateTask}>
          Add task
        </Button>
      </div>
      <Table<OnboardingTask>
        rowKey="id"
        size="small"
        loading={detail.isLoading}
        dataSource={tasks}
        pagination={false}
        columns={[
          { title: "Title", dataIndex: "title" },
          { title: "Resource", render: (_, t) => t.resource?.title ?? "—" },
          {
            title: "Order",
            render: (_, t, index) => (
              <Space size="small">
                <Button size="small" disabled={index === 0} onClick={() => moveTask.mutate({ id: t.id, direction: "up" })}>
                  ↑
                </Button>
                <Button size="small" disabled={index === tasks.length - 1} onClick={() => moveTask.mutate({ id: t.id, direction: "down" })}>
                  ↓
                </Button>
              </Space>
            ),
          },
          {
            title: "Actions",
            render: (_, t) => (
              <Space size="small">
                <Button size="small" onClick={() => openEditTask(t)}>
                  Edit
                </Button>
                <Popconfirm title="Remove this task?" onConfirm={() => deleteTask.mutate(t.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editingTask ? "Edit task" : "Add task"}
        open={taskModalOpen}
        onCancel={closeTaskModal}
        onOk={() => form.submit()}
        confirmLoading={createTask.isPending || updateTask.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => (editingTask ? updateTask.mutate(values) : createTask.mutate(values))}
        >
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="resource" label="Related resource (optional)">
            <Select
              allowClear
              loading={resources.isLoading}
              options={(resources.data ?? []).map((r) => ({ value: r.id, label: r.title }))}
              placeholder="No linked resource"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Employee progress tab
// ---------------------------------------------------------------------------

function ProgressTab() {
  const [search, setSearch] = useState("");
  const progress = useQuery({
    queryKey: ["onboarding-progress"],
    queryFn: () => api.get<OnboardingEmployeeProgress[]>("/onboarding/progress/"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return progress.data ?? [];
    return (progress.data ?? []).filter(
      (p) => p.employee.name.toLowerCase().includes(q) || p.department.name.toLowerCase().includes(q)
    );
  }, [progress.data, search]);

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search employees..."
          allowClear
          style={{ width: 240 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          prefix={<SearchOutlined />}
        />
      </div>
      <Table<OnboardingEmployeeProgress>
      rowKey={(row) => row.employee.id}
      loading={progress.isLoading}
      dataSource={filtered}
      locale={{ emptyText: search ? "No employees found. Try a different search." : "No employees found." }}
      columns={[
        { title: "Employee", dataIndex: ["employee", "name"] },
        { title: "Department", dataIndex: ["department", "name"] },
        { title: "Checklist", render: (_, row) => row.checklist?.name ?? <Typography.Text type="secondary">Unassigned</Typography.Text> },
        {
          title: "Progress",
          render: (_, row) =>
            row.total_tasks > 0 ? (
              <Progress percent={Math.round((row.completed_tasks / row.total_tasks) * 100)} size="small" format={() => `${row.completed_tasks}/${row.total_tasks}`} />
            ) : (
              "—"
            ),
        },
        {
          title: "Last activity",
          dataIndex: "last_activity_at",
          render: (v: string | null) => (v ? new Date(v).toLocaleString() : "—"),
        },
      ]}
      />
    </>
  );
}
