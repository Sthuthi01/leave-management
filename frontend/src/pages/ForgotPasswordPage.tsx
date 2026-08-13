import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api-client";

interface ForgotPasswordValues {
  email: string;
}

export function ForgotPasswordPage() {
  const [form] = Form.useForm<ForgotPasswordValues>();

  const submit = useMutation({
    mutationFn: (values: ForgotPasswordValues) => api.post<{ detail: string }>("/auth/forgot-password/", values),
  });

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          Forgot password
        </Typography.Title>

        {submit.isSuccess ? (
          <>
            <Alert
              type="success"
              showIcon
              message="If an account exists for that email, a reset link has been sent."
              style={{ marginBottom: 16 }}
            />
            <Link to="/login">Back to sign in</Link>
          </>
        ) : (
          <>
            <Typography.Paragraph type="secondary">
              Enter your email and we'll send you a link to reset your password.
            </Typography.Paragraph>
            <Form form={form} layout="vertical" onFinish={(values) => submit.mutate(values)}>
              <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
                <Input autoComplete="email" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={submit.isPending}>
                Send reset link
              </Button>
            </Form>
            <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
              <Link to="/login">Back to sign in</Link>
            </Typography.Paragraph>
          </>
        )}
      </Card>
    </div>
  );
}
