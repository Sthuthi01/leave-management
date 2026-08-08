"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { ROLE_OPTIONS, ROLE_FIELD_TOOLTIP, REPORTING_MANAGER_TOOLTIP } from "@/lib/rbac";
import type { Department, EmployeeWithRelations, OnboardingChecklist, Role } from "@/types";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Loader2Icon } from "lucide-react";

const schema = z.object({
  name: z.string().trim().min(2, "Name is required."),
  email: z.string().trim().email("Enter a valid email."),
  title: z.string().trim().min(2, "Title is required."),
  departmentId: z.string().min(1, "Select a department."),
  managerId: z.string(),
  role: z.enum(["EMPLOYEE", "MANAGER", "ADMIN"]),
  onboardingChecklistId: z.string(),
});

type FormValues = z.infer<typeof schema>;
const NO_MANAGER = "__none__";
const NO_CHECKLIST = "__none__";

export function EmployeeFormDialog({
  open,
  onOpenChange,
  employee,
  departments,
  managers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeWithRelations | null;
  departments: Department[];
  managers: EmployeeWithRelations[];
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(employee);
  const { data: checklists } = useQuery({ queryKey: ["onboarding-checklists"], queryFn: () => api.get<OnboardingChecklist[]>("/onboarding/checklists") });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", title: "", departmentId: "", managerId: NO_MANAGER, role: "EMPLOYEE", onboardingChecklistId: NO_CHECKLIST },
  });

  useEffect(() => {
    if (open) {
      reset(
        employee
          ? {
              name: employee.name,
              email: employee.email,
              title: employee.title,
              departmentId: employee.departmentId,
              managerId: employee.managerId ?? NO_MANAGER,
              role: employee.role,
              onboardingChecklistId: employee.onboardingChecklistId ?? NO_CHECKLIST,
            }
          : { name: "", email: "", title: "", departmentId: "", managerId: NO_MANAGER, role: "EMPLOYEE", onboardingChecklistId: NO_CHECKLIST }
      );
    }
  }, [open, employee, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        ...values,
        managerId: values.managerId === NO_MANAGER ? null : values.managerId,
        onboardingChecklistId: values.onboardingChecklistId === NO_CHECKLIST ? null : values.onboardingChecklistId,
      };
      return isEdit ? api.patch(`/employees/${employee!.id}`, payload) : api.post("/employees", payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Employee updated." : "Employee added — an invitation email has been sent.");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  const managerOptions = managers.filter((m) => m.id !== employee?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit employee" : "Add employee"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update this employee's profile." : "Add a new employee to the directory."}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Job title</Label>
            <Input id="title" {...register("title")} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Department</Label>
              <Controller
                name="departmentId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} items={departments.map((d) => ({ value: d.id, label: d.name }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.departmentId && <p className="text-xs text-destructive">{errors.departmentId.message}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>
                Role
                <InfoTooltip text={ROLE_FIELD_TOOLTIP} />
              </Label>
              <Controller
                name="role"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(v as Role)} items={ROLE_OPTIONS}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              Reporting Manager
              <InfoTooltip text={REPORTING_MANAGER_TOOLTIP} />
            </Label>
            <Controller
              name="managerId"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  items={[{ value: NO_MANAGER, label: "No manager" }, ...managerOptions.map((m) => ({ value: m.id, label: m.name }))]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_MANAGER}>No manager</SelectItem>
                    {managerOptions.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              Onboarding checklist <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Controller
              name="onboardingChecklistId"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  items={[{ value: NO_CHECKLIST, label: "None" }, ...(checklists ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CHECKLIST}>None</SelectItem>
                    {checklists?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground">Assigns this person the checklist under Onboarding → My Checklist.</p>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" />}
              {isEdit ? "Save changes" : "Add employee"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
