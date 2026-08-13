import { useState } from "react";
import { Button, Empty, Form, Input, Modal, Popconfirm, Table, Tag, Typography, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";
import type { Department, Employee } from "../types";

interface DepartmentFormValues {
  name: string;
}

export function DepartmentsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form] = Form.useForm<DepartmentFormValues>();

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Department[]>("/departments/"),
  });
  // Employee counts are computed client-side from the existing employees list rather than adding
  // a new backend field — the source app's Departments page shows a per-department employee-count
  // badge, and this is the only data already available that produces it.
  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.get<Employee[]>("/employees/"),
  });
  const countByDepartment = (employees.data ?? []).reduce<Record<number, number>>((acc, employee) => {
    acc[employee.department.id] = (acc[employee.department.id] ?? 0) + 1;
    return acc;
  }, {});

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["departments"] });

  const createDepartment = useMutation({
    mutationFn: (values: DepartmentFormValues) => api.post<Department>("/departments/", values),
    onSuccess: () => {
      message.success("Department added.");
      invalidate();
      closeModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not add department."),
  });

  const updateDepartment = useMutation({
    mutationFn: (values: DepartmentFormValues) => api.patch<Department>(`/departments/${editing!.id}/`, values),
    onSuccess: () => {
      message.success("Department updated.");
      invalidate();
      closeModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not update department."),
  });

  const deleteDepartment = useMutation({
    mutationFn: (id: number) => api.delete(`/departments/${id}/`),
    onSuccess: () => {
      message.success("Department deleted.");
      invalidate();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not delete department."),
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ name: "" });
    setModalOpen(true);
  };

  const openEdit = (department: Department) => {
    setEditing(department);
    form.setFieldsValue({ name: department.name });
    setModalOpen(true);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Departments
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add department
        </Button>
      </div>

      <Table<Department>
        rowKey="id"
        loading={departments.isLoading}
        dataSource={departments.data ?? []}
        locale={{ emptyText: <Empty description="No departments yet." /> }}
        columns={[
          { title: "Name", dataIndex: "name" },
          {
            title: "Employees",
            render: (_, record) => <Tag>{countByDepartment[record.id] ?? 0}</Tag>,
          },
          {
            title: "Actions",
            render: (_, record) => (
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="small" onClick={() => openEdit(record)}>
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this department?"
                  description="This can't be undone."
                  onConfirm={() => deleteDepartment.mutate(record.id)}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    size="small"
                    danger
                    loading={deleteDepartment.isPending && deleteDepartment.variables === record.id}
                  >
                    Delete
                  </Button>
                </Popconfirm>
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `Edit ${editing.name}` : "Add department"}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createDepartment.isPending || updateDepartment.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => (editing ? updateDepartment.mutate(values) : createDepartment.mutate(values))}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a department name." }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
