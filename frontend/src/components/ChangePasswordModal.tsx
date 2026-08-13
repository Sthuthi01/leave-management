import { Alert, Form, Input, Modal, message } from "antd";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";

interface ChangePasswordValues {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<ChangePasswordValues>();

  const changePassword = useMutation({
    mutationFn: (values: ChangePasswordValues) =>
      api.post("/auth/change-password/", { current_password: values.current_password, new_password: values.new_password }),
    onSuccess: () => {
      message.success("Password changed.");
      form.resetFields();
      onClose();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not change password."),
  });

  return (
    <Modal
      title="Change password"
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={() => form.submit()}
      confirmLoading={changePassword.isPending}
    >
      {changePassword.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={changePassword.error instanceof ApiError ? changePassword.error.message : "Something went wrong."}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => {
          if (values.new_password !== values.confirm_password) {
            form.setFields([{ name: "confirm_password", errors: ["Passwords do not match."] }]);
            return;
          }
          changePassword.mutate(values);
        }}
      >
        <Form.Item name="current_password" label="Current password" rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="new_password"
          label="New password"
          rules={[{ required: true }]}
          extra="At least 10 characters, with a letter and a number."
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="confirm_password" label="Confirm new password" rules={[{ required: true }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
