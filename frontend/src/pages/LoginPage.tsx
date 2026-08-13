import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api-client";
import type { Employee } from "../types";

interface LoginValues {
  email: string;
  password: string;
}

export function LoginPage() {
  const [form] = Form.useForm<LoginValues>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (values: LoginValues) => api.post<Employee>("/auth/login/", values),
    onSuccess: (employee) => {
      queryClient.setQueryData(["me"], employee);
      navigate("/");
    },
  });

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          Agrileaf
        </Typography.Title>
        <Typography.Paragraph type="secondary">Sign in to your account.</Typography.Paragraph>

        {mutation.isError && (
          <Alert
            type="error"
            showIcon
            message={mutation.error instanceof ApiError ? mutation.error.message : "Sign-in failed. Please try again."}
            style={{ marginBottom: 16 }}
          />
        )}

        <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input autoComplete="email" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={mutation.isPending}>
            Sign in
          </Button>
        </Form>
        <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
          <Link to="/forgot-password">Forgot your password?</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
