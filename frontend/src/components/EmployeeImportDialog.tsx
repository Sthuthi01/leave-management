import { useState } from "react";
import { Alert, Badge, Button, Modal, Popconfirm, Table, Typography, Upload, message } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";
import { downloadCsv } from "../lib/csv";
import {
  EMPLOYEE_IMPORT_COLUMNS,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  buildImportTemplateRows,
  parseEmployeeImportFile,
  validateImportRows,
  type EmployeeImportRowResult,
} from "../lib/employee-import";
import type { Department, Employee, OnboardingChecklist } from "../types";

interface EmployeeImportDialogProps {
  open: boolean;
  onClose: () => void;
  departments: Department[];
  employees: Employee[];
  checklists: OnboardingChecklist[];
}

export function EmployeeImportDialog({ open, onClose, departments, employees, checklists }: EmployeeImportDialogProps) {
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<EmployeeImportRowResult[] | null>(null);

  const validRows = rows?.filter((r) => r.data !== null) ?? [];
  const invalidRows = rows?.filter((r) => r.data === null) ?? [];

  function reset() {
    setFileName(null);
    setParsing(false);
    setParseError(null);
    setRows(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function downloadTemplate() {
    downloadCsv("employee-import-template.csv", buildImportTemplateRows(departments[0]?.name));
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    setParseError(null);
    setRows(null);

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setParseError(`This file is too large. The limit is ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))}MB.`);
      return;
    }

    setParsing(true);
    try {
      const rawRows = await parseEmployeeImportFile(file);
      const requiredHeaders = [EMPLOYEE_IMPORT_COLUMNS.name, EMPLOYEE_IMPORT_COLUMNS.email];
      const headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
      const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));

      if (rawRows.length === 0) {
        setParseError("No rows found in this file.");
      } else if (missingHeaders.length > 0) {
        setParseError(
          `This file doesn't match the template — missing column${missingHeaders.length > 1 ? "s" : ""}: ${missingHeaders.join(", ")}. Download the template below to see the expected format.`
        );
      } else if (rawRows.length > MAX_IMPORT_ROWS) {
        setParseError(`This file has ${rawRows.length} rows — the limit per import is ${MAX_IMPORT_ROWS}.`);
      } else {
        setRows(validateImportRows(rawRows, { departments, employees, checklists }));
      }
    } catch {
      setParseError("Couldn't read this file. Make sure it's a valid .csv or .xlsx file.");
    } finally {
      setParsing(false);
    }
  }

  const importMutation = useMutation({
    mutationFn: () => api.post<{ created: number; skipped: number }>("/employees/import/", { rows: validRows.map((r) => r.data) }),
    onSuccess: (res) => {
      message.success(`Imported ${res.created} employee${res.created === 1 ? "" : "s"}.${res.skipped > 0 ? ` ${res.skipped} skipped.` : ""}`);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      handleClose();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Import failed."),
  });

  return (
    <Modal title="Import employees" open={open} onCancel={handleClose} width={720} footer={null}>
      <Typography.Paragraph type="secondary">
        Bulk-add employees from a CSV or Excel file. Download the template to see the expected columns.
      </Typography.Paragraph>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
          Download template
        </Button>
        <Upload
          showUploadList={false}
          accept=".csv,.xlsx,.xls"
          beforeUpload={(file) => {
            handleFile(file);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} loading={parsing}>
            {fileName ? "Choose a different file" : "Choose file"}
          </Button>
        </Upload>
        {fileName && <Typography.Text type="secondary">{fileName}</Typography.Text>}
      </div>

      {parseError && <Alert type="error" showIcon message={parseError} style={{ marginBottom: 16 }} />}

      {rows && rows.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
            <Typography.Text type="success">{validRows.length} ready to import</Typography.Text>
            {invalidRows.length > 0 && <Typography.Text type="danger">{invalidRows.length} with errors (will be skipped)</Typography.Text>}
          </div>

          <Table
            size="small"
            rowKey="rowNumber"
            dataSource={rows}
            pagination={false}
            scroll={{ y: 320 }}
            columns={[
              { title: "Row", dataIndex: "rowNumber", width: 60 },
              { title: "Name", render: (_, r: EmployeeImportRowResult) => r.raw[EMPLOYEE_IMPORT_COLUMNS.name] || "—" },
              { title: "Email", render: (_, r: EmployeeImportRowResult) => r.raw[EMPLOYEE_IMPORT_COLUMNS.email] || "—" },
              { title: "Department", render: (_, r: EmployeeImportRowResult) => r.raw[EMPLOYEE_IMPORT_COLUMNS.department] || "—" },
              {
                title: "Status",
                render: (_, r: EmployeeImportRowResult) =>
                  r.errors.length === 0 ? (
                    <Badge status="success" text="Ready" />
                  ) : (
                    <div>
                      <Badge status="error" text="Error" />
                      {r.errors.map((err, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#ff4d4f" }}>
                          {err}
                        </div>
                      ))}
                    </div>
                  ),
              },
            ]}
          />
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button onClick={handleClose}>Cancel</Button>
        <Popconfirm
          title="Import employees?"
          description={
            <>
              This will add {validRows.length} new employee{validRows.length === 1 ? "" : "s"} to the directory.
              {invalidRows.length > 0 && ` ${invalidRows.length} row${invalidRows.length === 1 ? "" : "s"} with errors will be skipped.`}
            </>
          }
          okText="Import"
          disabled={validRows.length === 0}
          onConfirm={() => importMutation.mutate()}
        >
          <Button type="primary" disabled={validRows.length === 0} loading={importMutation.isPending}>
            Import {validRows.length > 0 ? `${validRows.length} employee${validRows.length === 1 ? "" : "s"}` : ""}
          </Button>
        </Popconfirm>
      </div>
    </Modal>
  );
}
