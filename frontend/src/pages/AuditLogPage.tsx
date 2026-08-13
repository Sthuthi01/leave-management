import { Alert, Table, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api } from "../lib/api-client";
import { useCurrentUser } from "../hooks/useCurrentUser";
import type { AuditLogEntry } from "../types";

export function AuditLogPage() {
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === "ADMIN";

  const entries = useQuery({
    queryKey: ["audit-log"],
    queryFn: () => api.get<AuditLogEntry[]>("/audit-log/"),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <Alert
        type="info"
        showIcon
        message="Signed in"
        description={`Welcome, ${currentUser?.name}. The audit log is HR-Admin only.`}
      />
    );
  }

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 16 }}>
        Audit Log
      </Typography.Title>

      <Table<AuditLogEntry>
        rowKey="id"
        loading={entries.isLoading}
        dataSource={entries.data ?? []}
        columns={[
          {
            title: "When",
            dataIndex: "timestamp",
            render: (value: string) => dayjs(value).format("D MMM YYYY, HH:mm"),
            width: 180,
          },
          { title: "Who", dataIndex: "actor_name", width: 180 },
          { title: "Action", dataIndex: "action", width: 200 },
          {
            title: "Target",
            render: (_, record) => `${record.target_type}: ${record.target_label}`,
          },
          {
            title: "Details",
            dataIndex: "details",
            render: (value: string | null) => value ?? "—",
          },
        ]}
      />
    </>
  );
}
