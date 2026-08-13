import { Alert, Button, Card, Form, InputNumber, Switch, Typography, message } from "antd";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";
import { useCurrentUser } from "../hooks/useCurrentUser";
import type { OrganizationSettings } from "../types";

// 0=Monday ... 6=Sunday, matching the backend's date.weekday() convention.
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function WorkingDaysToggle({ value, onChange }: { value?: number[]; onChange?: (next: number[]) => void }) {
  const selected = value ?? [];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {DAY_LABELS.map((label, day) => (
        <label
          key={label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid #d9d9d9",
            borderRadius: 8,
            padding: "8px 12px",
            fontWeight: 500,
          }}
        >
          <Switch
            size="small"
            checked={selected.includes(day)}
            onChange={(checked) => {
              const next = new Set(selected);
              if (checked) next.add(day);
              else next.delete(day);
              onChange?.([...next].sort((a, b) => a - b));
            }}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [form] = Form.useForm<OrganizationSettings>();

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<OrganizationSettings>("/settings/"),
  });

  useEffect(() => {
    if (settings.data) form.setFieldsValue(settings.data);
  }, [settings.data, form]);

  const mutation = useMutation({
    mutationFn: (values: OrganizationSettings) => api.patch<OrganizationSettings>("/settings/", values),
    onSuccess: (updated) => {
      message.success("Settings saved.");
      queryClient.setQueryData(["settings"], updated);
      form.setFieldsValue(updated);
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not save settings."),
  });

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Settings
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Organization-wide configuration used across leave calculations, the audit log, and session handling.
      </Typography.Paragraph>

      {!isAdmin ? (
        <Alert
          type="info"
          showIcon
          message="Read-only"
          description={`Welcome, ${currentUser?.name}. Settings are visible to everyone but can only be changed by an HR Admin.`}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Form
        form={form}
        layout="vertical"
        disabled={!isAdmin || settings.isLoading}
        onFinish={(values) => mutation.mutate(values)}
      >
        <Card title="Working days" style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary">
            Which days of the week count toward leave-day calculations across the app.
          </Typography.Paragraph>
          <Form.Item
            name="working_days"
            rules={[{ required: true, message: "Select at least one working day." }]}
          >
            <WorkingDaysToggle />
          </Form.Item>
        </Card>

        <Card title="Thresholds & limits" style={{ marginBottom: 16 }}>
          <Form.Item
            name="pending_approval_urgency_days"
            label="Pending approval urgency (days)"
            rules={[{ required: true, type: "number", min: 1 }]}
            extra="Flags a pending approval as urgent once it's waited this long."
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="audit_log_display_limit"
            label="Audit log entries shown"
            rules={[{ required: true, type: "number", min: 1 }]}
            extra="How many recent audit log entries are displayed."
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="session_max_age_days"
            label="Session timeout (days)"
            rules={[{ required: true, type: "number", min: 1 }]}
            extra="How long a signed-in session stays valid before requiring sign-in again. Only applies to sessions created after this is saved — existing sessions keep their current expiry."
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
        </Card>

        {isAdmin && (
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            Save changes
          </Button>
        )}
      </Form>
    </>
  );
}
