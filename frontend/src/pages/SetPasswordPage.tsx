import { useMemo } from "react";
import { Alert, Button, Card, Form, Input, Skeleton, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api-client";
import type { Employee } from "../types";

interface TokenCheckResponse {
  valid: boolean;
  purpose?: "INVITE" | "RESET";
  name?: string;
  email?: string;
  reason?: string;
}

interface SetPasswordValues {
  password: string;
  confirmPassword: string;
}

export function SetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<SetPasswordValues>();

  const check = useQuery({
    queryKey: ["set-password-token", token],
    queryFn: () => api.get<TokenCheckResponse>(`/auth/set-password/?token=${encodeURIComponent(token)}`),
    enabled: token.length > 0,
  });

  const submit = useMutation({
    mutationFn: (values: SetPasswordValues) => api.post<Employee>("/auth/set-password/", { token, password: values.password }),
    onSuccess: (employee) => {
      queryClient.setQueryData(["me"], employee);
      navigate("/");
    },
  });

  const content = () => {
    if (!token) {
      return <Alert type="error" showIcon message="This link is missing its token. Please check the link or ask for a new one." />;
    }
    if (check.isLoading) return <Skeleton active />;
    if (!check.data?.valid) {
      return <Alert type="error" showIcon message="This link isn't valid. Please check the link or ask for a new one." />;
    }

    return (
      <>
        <Typography.Paragraph type="secondary">Setting a password for {check.data.email}.</Typography.Paragraph>
        {submit.isError && (
          <Alert
            type="error"
            showIcon
            message={submit.error instanceof ApiError ? submit.error.message : "Something went wrong. Please try again."}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => {
            if (values.password !== values.confirmPassword) {
              form.setFields([{ name: "confirmPassword", errors: ["Passwords do not match."] }]);
              return;
            }
            submit.mutate(values);
          }}
        >
          <Form.Item
            name="password"
            label="New password"
            rules={[{ required: true }]}
            extra="At least 10 characters, with a letter and a number."
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="confirmPassword" label="Confirm password" rules={[{ required: true }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submit.isPending}>
            {check.data.purpose === "RESET" ? "Reset password" : "Set up account"}
          </Button>
        </Form>
      </>
    );
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <Card style={{ width: 400 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {check.data?.purpose === "RESET" ? "Reset your password" : "Set up your account"}
        </Typography.Title>
        {content()}
      </Card>
    </div>
  );
}
