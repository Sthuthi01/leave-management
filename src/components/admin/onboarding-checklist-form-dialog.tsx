"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import type { OnboardingChecklist } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Loader2Icon } from "lucide-react";

const schema = z.object({
  name: z.string().trim().min(2, "Name is required."),
  description: z.string().trim().optional(),
});

type FormValues = z.infer<typeof schema>;

export function OnboardingChecklistFormDialog({
  open,
  onOpenChange,
  checklist,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklist: OnboardingChecklist | null;
  onCreated?: (checklist: OnboardingChecklist) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(checklist);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "", description: "" } });

  useEffect(() => {
    if (open) reset(checklist ? { name: checklist.name, description: checklist.description ?? "" } : { name: "", description: "" });
  }, [open, checklist, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      isEdit
        ? api.patch<OnboardingChecklist>(`/onboarding/checklists/${checklist!.id}`, values)
        : api.post<OnboardingChecklist>("/onboarding/checklists", values),
    onSuccess: (saved) => {
      toast.success(isEdit ? "Checklist updated." : "Checklist added.");
      queryClient.invalidateQueries({ queryKey: ["onboarding-checklists"] });
      onOpenChange(false);
      if (!isEdit) onCreated?.(saved);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit checklist" : "Add checklist"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update this checklist's name and description." : "Create a new onboarding checklist, then add tasks to it."}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-name">Name</Label>
            <Input id="cl-name" placeholder="e.g. Engineering Onboarding" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-description">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id="cl-description" rows={2} placeholder="Who this checklist is for." {...register("description")} />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" />}
              {isEdit ? "Save changes" : "Add checklist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
