import { Alert, Checkbox, List, Progress, Tag, Typography, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";
import type { MyOnboardingChecklist } from "../types";

export function MyChecklistPage() {
  const queryClient = useQueryClient();
  const myChecklist = useQuery({
    queryKey: ["my-onboarding-checklist"],
    queryFn: () => api.get<MyOnboardingChecklist | null>("/onboarding/my-checklist/"),
  });

  const toggleCompletion = useMutation({
    mutationFn: ({ taskId, completed }: { taskId: number; completed: boolean }) =>
      api.post(`/onboarding/tasks/${taskId}/complete/`, { completed }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-onboarding-checklist"] }),
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Could not update task."),
  });

  if (myChecklist.isLoading) return null;

  if (!myChecklist.data) {
    return (
      <>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          My Checklist
        </Typography.Title>
        <Alert type="info" showIcon message="No checklist assigned" description="You don't have an onboarding checklist assigned yet." />
      </>
    );
  }

  const { checklist, tasks } = myChecklist.data;
  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {checklist.name}
      </Typography.Title>
      {checklist.description && <Typography.Paragraph type="secondary">{checklist.description}</Typography.Paragraph>}

      <Progress percent={tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0} style={{ marginBottom: 24, maxWidth: 400 }} />

      <List
        dataSource={tasks}
        renderItem={(task) => (
          <List.Item>
            <Checkbox
              checked={task.completed}
              onChange={(e) => toggleCompletion.mutate({ taskId: task.id, completed: e.target.checked })}
            >
              <span style={{ textDecoration: task.completed ? "line-through" : "none" }}>{task.title}</span>
            </Checkbox>
            {task.resource && (
              <Tag style={{ marginLeft: 12 }} color="blue">
                {task.resource.title}
              </Tag>
            )}
            {task.description && (
              <Typography.Paragraph type="secondary" style={{ marginLeft: 24, marginBottom: 0 }}>
                {task.description}
              </Typography.Paragraph>
            )}
          </List.Item>
        )}
      />
    </>
  );
}
