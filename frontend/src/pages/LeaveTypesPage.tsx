import { useState } from "react";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";
import type { AccrualMethod, LeaveType } from "../types";

interface LeaveTypeFormValues {
  name: string;
  code: string;
  color: string;
  default_days_per_year: number;
  requires_approval: boolean;
  accrual_method: AccrualMethod;
  carry_forward_limit: number;
}

const DEFAULT_VALUES: LeaveTypeFormValues = {
  name: "",
  code: "",
  color: "#16a34a",
  default_days_per_year: 0,
  requires_approval: true,
  accrual_method: "ANNUAL",
  carry_forward_limit: 0,
};

export function LeaveTypesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [form] = Form.useForm<LeaveTypeFormValues>();

  const leaveTypes = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => api.get<LeaveType[]>("/leave-types/"),
  });

  const createLeaveType = useMutation({
    mutationFn: (values: LeaveTypeFormValues) => api.post<LeaveType>("/leave-types/", values),
    onSuccess: () => {
      message.success("Leave type created.");
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
      closeModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not create leave type."),
  });

  const updateLeaveType = useMutation({
    mutationFn: (values: LeaveTypeFormValues) => api.patch<LeaveType>(`/leave-types/${editing!.id}/`, values),
    onSuccess: () => {
      message.success("Leave type updated.");
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
      closeModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not update leave type."),
  });

  const toggleActive = useMutation({
    mutationFn: (record: LeaveType) => api.patch<LeaveType>(`/leave-types/${record.id}/`, { is_active: !record.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not update leave type."),
  });

  const deleteLeaveType = useMutation({
    mutationFn: (record: LeaveType) => api.delete(`/leave-types/${record.id}/`),
    onSuccess: () => {
      message.success("Leave type deleted.");
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not delete leave type."),
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openCreate = () => {
    form.setFieldsValue(DEFAULT_VALUES);
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: LeaveType) => {
    form.setFieldsValue({
      name: record.name,
      code: record.code,
      color: record.color,
      default_days_per_year: record.default_days_per_year,
      requires_approval: record.requires_approval,
      accrual_method: record.accrual_method,
      carry_forward_limit: record.carry_forward_limit,
    });
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = (values: LeaveTypeFormValues) => {
    if (editing) updateLeaveType.mutate(values);
    else createLeaveType.mutate(values);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Leave Types
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add leave type
        </Button>
      </div>

      <Table<LeaveType>
        rowKey="id"
        loading={leaveTypes.isLoading}
        dataSource={leaveTypes.data ?? []}
        columns={[
          {
            title: "Name",
            render: (_, record) => (
              <>
                <Tag color={record.color}>{record.code}</Tag>
                {record.name}
              </>
            ),
          },
          { title: "Default days/yr", dataIndex: "default_days_per_year", align: "right" },
          { title: "Carry-forward limit", dataIndex: "carry_forward_limit", align: "right" },
          { title: "Accrual", dataIndex: "accrual_method" },
          {
            title: "Requires approval",
            dataIndex: "requires_approval",
            render: (v: boolean) => (v ? "Yes" : "No"),
          },
          {
            title: "Status",
            render: (_, record) => (
              <Switch
                checked={record.is_active}
                checkedChildren="Active"
                unCheckedChildren="Inactive"
                loading={toggleActive.isPending && toggleActive.variables?.id === record.id}
                onChange={() => toggleActive.mutate(record)}
              />
            ),
          },
          {
            title: "Actions",
            render: (_, record) => (
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="small" onClick={() => openEdit(record)}>
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this leave type?"
                  description="This can't be undone."
                  onConfirm={() => deleteLeaveType.mutate(record)}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" danger loading={deleteLeaveType.isPending && deleteLeaveType.variables?.id === record.id}>
                    Delete
                  </Button>
                </Popconfirm>
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `Edit ${editing.name}` : "Add leave type"}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createLeaveType.isPending || updateLeaveType.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={DEFAULT_VALUES}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="Code" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="color" label="Color" rules={[{ required: true }]}>
            <Input type="color" style={{ width: 80, padding: 2 }} />
          </Form.Item>
          <Form.Item name="default_days_per_year" label="Default days per year" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="carry_forward_limit" label="Carry-forward limit" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="accrual_method" label="Accrual method" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "ANNUAL", label: "Annual" },
                { value: "MONTHLY", label: "Monthly" },
              ]}
            />
          </Form.Item>
          <Form.Item name="requires_approval" label="Requires approval" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
