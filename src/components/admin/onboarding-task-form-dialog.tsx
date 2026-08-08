"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import type { OnboardingResource, OnboardingTaskWithResource } from "@/types";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Loader2Icon } from "lucide-react";

const schema = z.object({
  title: z.string().trim().min(2, "Title is required."),
  description: z.string().trim().optional(),
  resourceId: z.string(),
});

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { title: "", description: "", resourceId: "none" };

export function OnboardingTaskFormDialog({
  open,
  onOpenChange,
  checklistId,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklistId: string;
  task: OnboardingTaskWithResource | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(task);
  const { data: resources } = useQuery({ queryKey: ["onboarding-resources"], queryFn: () => api.get<OnboardingResource[]>("/onboarding/resources") });
  const activeResources = resources?.filter((r) => r.status === "PUBLISHED") ?? [];

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (open) {
      reset(task ? { title: task.title, description: task.description ?? "", resourceId: task.resourceId ?? "none" } : EMPTY);
    }
  }, [open, task, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = { title: values.title, description: values.description || null, resourceId: values.resourceId === "none" ? null : values.resourceId };
      return isEdit ? api.patch(`/onboarding/tasks/${task!.id}`, payload) : api.post(`/onboarding/checklists/${checklistId}/tasks`, payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Task updated." : "Task added.");
      queryClient.invalidateQueries({ queryKey: ["onboarding-checklist", checklistId] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit task" : "Add task"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this task." : "Add a step to this checklist — optionally link it to a resource employees should read."}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input id="task-title" placeholder="e.g. Read the Employee Handbook" {...register("title")} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-description">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id="task-description" rows={2} placeholder="Any extra context for this step." {...register("description")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-resource">
              Linked resource <span className="font-normal text-muted-foreground">(optional)</span>
              <InfoTooltip text="Shown inline when the employee opens this step." />
            </Label>
            <Controller
              name="resourceId"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  items={[{ value: "none", label: "No linked resource" }, ...activeResources.map((r) => ({ value: r.id, label: r.title }))]}
                >
                  <SelectTrigger id="task-resource" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked resource</SelectItem>
                    {activeResources.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" />}
              {isEdit ? "Save changes" : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
