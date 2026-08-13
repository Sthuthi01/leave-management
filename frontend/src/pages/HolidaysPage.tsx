import { useMemo, useState } from "react";
import { Button, DatePicker, Dropdown, Form, Input, Modal, Popconfirm, Select, Switch, Table, Tag, Typography, message } from "antd";
import { DownloadOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { api, ApiError } from "../lib/api-client";
import { downloadCsv } from "../lib/csv";
import { buildHolidayExportRows } from "../lib/holiday-import";
import { HolidayImportDialog } from "../components/HolidayImportDialog";
import type { Holiday } from "../types";

interface HolidayFormValues {
  name: string;
  date: Dayjs;
  optional: boolean;
}

const DEFAULT_VALUES = { name: "", optional: false };

export function HolidaysPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [year, setYear] = useState<number>(dayjs().year());
  const [form] = Form.useForm<HolidayFormValues>();

  const holidays = useQuery({
    queryKey: ["holidays"],
    queryFn: () => api.get<Holiday[]>("/holidays/"),
  });

  const yearOptions = useMemo(() => {
    const currentYear = dayjs().year();
    const years = new Set<number>([currentYear - 1, currentYear, currentYear + 1]);
    for (const h of holidays.data ?? []) years.add(dayjs(h.date).year());
    return Array.from(years).sort((a, b) => a - b).map((y) => ({ value: y, label: String(y) }));
  }, [holidays.data]);

  const filteredHolidays = (holidays.data ?? []).filter((h) => dayjs(h.date).year() === year);

  const createHoliday = useMutation({
    mutationFn: (values: { name: string; date: string; optional: boolean }) =>
      api.post<Holiday>("/holidays/", values),
    onSuccess: () => {
      message.success("Holiday added.");
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      closeModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not add holiday."),
  });

  const updateHoliday = useMutation({
    mutationFn: (values: { name: string; date: string; optional: boolean }) =>
      api.patch<Holiday>(`/holidays/${editing!.id}/`, values),
    onSuccess: () => {
      message.success("Holiday updated.");
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      closeModal();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not update holiday."),
  });

  const deleteHoliday = useMutation({
    mutationFn: (holiday: Holiday) => api.delete(`/holidays/${holiday.id}/`),
    onSuccess: () => {
      message.success("Holiday deleted.");
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not delete holiday."),
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openCreate = () => {
    form.setFieldsValue({ ...DEFAULT_VALUES, date: undefined });
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: Holiday) => {
    form.setFieldsValue({ name: record.name, date: dayjs(record.date), optional: record.optional });
    setEditing(record);
    setModalOpen(true);
  };

  function exportHolidays(scope: "year" | "all") {
    const all = holidays.data ?? [];
    const source = scope === "year" ? filteredHolidays : all;
    if (source.length === 0) {
      message.error("No holidays to export.");
      return;
    }
    downloadCsv(`holidays-${scope === "year" ? year : "all"}.csv`, buildHolidayExportRows(source));
  }

  const exportMenuItems: MenuProps["items"] = [
    { key: "year", label: `Export ${year} (${filteredHolidays.length})`, onClick: () => exportHolidays("year") },
    { key: "all", label: `Export all (${holidays.data?.length ?? 0})`, onClick: () => exportHolidays("all") },
  ];

  const handleSubmit = (values: HolidayFormValues) => {
    const payload = { name: values.name, date: values.date.format("YYYY-MM-DD"), optional: values.optional };
    if (editing) updateHoliday.mutate(payload);
    else createHoliday.mutate(payload);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Holidays
        </Typography.Title>
        <div style={{ display: "flex", gap: 12 }}>
          <Select value={year} onChange={setYear} options={yearOptions} style={{ width: 100 }} />
          <Dropdown menu={{ items: exportMenuItems }}>
            <Button icon={<DownloadOutlined />}>Export</Button>
          </Dropdown>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
            Import
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add holiday
          </Button>
        </div>
      </div>

      <Table<Holiday>
        rowKey="id"
        loading={holidays.isLoading}
        dataSource={filteredHolidays}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Date", dataIndex: "date", render: (d: string) => dayjs(d).format("D MMM YYYY") },
          { title: "Day", dataIndex: "date", render: (d: string) => dayjs(d).format("dddd") },
          {
            title: "Type",
            dataIndex: "optional",
            render: (optional: boolean) => (optional ? <Tag>Optional</Tag> : <Tag color="green">Mandatory</Tag>),
          },
          {
            title: "Actions",
            render: (_, record) => (
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="small" onClick={() => openEdit(record)}>
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this holiday?"
                  description={`"${record.name}" will no longer be excluded from working-day calculations.`}
                  onConfirm={() => deleteHoliday.mutate(record)}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" danger loading={deleteHoliday.isPending && deleteHoliday.variables?.id === record.id}>
                    Delete
                  </Button>
                </Popconfirm>
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `Edit ${editing.name}` : "Add holiday"}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createHoliday.isPending || updateHoliday.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={DEFAULT_VALUES}>
          <Form.Item name="name" label="Holiday name" rules={[{ required: true, min: 2, message: "Name must be at least 2 characters." }]}>
            <Input />
          </Form.Item>
          <Form.Item name="date" label="Date" rules={[{ required: true, message: "Date is required." }]}>
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="optional" label="Optional holiday" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <HolidayImportDialog open={importOpen} onClose={() => setImportOpen(false)} existingHolidays={holidays.data ?? []} />
    </>
  );
}
