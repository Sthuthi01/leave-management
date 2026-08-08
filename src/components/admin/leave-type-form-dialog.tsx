"use client";

import { useEffect } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import type { AccrualMethod, LeaveType } from "@/types";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Loader2Icon } from "lucide-react";

export const ACCRUAL_LABELS: Record<AccrualMethod, string> = {
  ANNUAL: "Annual (available immediately)",
  MONTHLY: "Monthly (accrues through the year)",
};

export const ACCRUAL_METHOD_TOOLTIP = "How this leave type's balance becomes available over the year.";
export const CARRY_FORWARD_TOOLTIP = "Unused days that roll over into next year.";

const schema = z.object({
  name: z.string().trim().min(2, "Name is required."),
  code: z.string().trim().min(1, "Code is required.").max(6, "Keep it short (max 6 characters)."),
  color: z.string().min(1),
  defaultDaysPerYear: z.number().min(0, "Must be zero or more."),
  requiresApproval: z.boolean(),
  accrualMethod: z.enum(["ANNUAL", "MONTHLY"]),
  carryForwardLimit: z.number().min(0, "Must be zero or more."),
});

type FormValues = z.infer<typeof schema>;

export function LeaveTypeFormDialog({
  open,
  onOpenChange,
  leaveType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaveType: LeaveType | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(leaveType);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", color: "#2563eb", defaultDaysPerYear: 0, requiresApproval: true, accrualMethod: "ANNUAL", carryForwardLimit: 0 },
  });

  const defaultDaysPerYear = useWatch({ control, name: "defaultDaysPerYear" });
  const isUncapped = defaultDaysPerYear === 0;

  useEffect(() => {
    if (open) {
      reset(
        leaveType
          ? {
              name: leaveType.name,
              code: leaveType.code,
              color: leaveType.color,
              defaultDaysPerYear: leaveType.defaultDaysPerYear,
              requiresApproval: leaveType.requiresApproval,
              accrualMethod: leaveType.accrualMethod,
              carryForwardLimit: leaveType.carryForwardLimit,
            }
          : { name: "", code: "", color: "#2563eb", defaultDaysPerYear: 0, requiresApproval: true, accrualMethod: "ANNUAL", carryForwardLimit: 0 }
      );
    }
  }, [open, leaveType, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = { ...values, carryForwardLimit: values.defaultDaysPerYear === 0 ? 0 : values.carryForwardLimit };
      return isEdit ? api.patch(`/leave-types/${leaveType!.id}`, payload) : api.post("/leave-types", payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Leave type updated." : "Leave type added.");
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit leave type" : "Add leave type"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update this leave type's settings." : "Define a new kind of leave employees can apply for."}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lt-name">Name</Label>
            <Input id="lt-name" placeholder="e.g. Casual Leave" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-code">Code</Label>
              <Input id="lt-code" placeholder="CL" className="uppercase" {...register("code")} />
              {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-color">Color</Label>
              <Controller
                name="color"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={field.value}
                      onChange={field.onChange}
                      className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                    />
                    <Input value={field.value} onChange={field.onChange} />
                  </div>
                )}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lt-days">Default days per year</Label>
            <Input id="lt-days" type="number" min={0} step={1} {...register("defaultDaysPerYear", { valueAsNumber: true })} />
            {errors.defaultDaysPerYear && <p className="text-xs text-destructive">{errors.defaultDaysPerYear.message}</p>}
            <p className="text-xs text-muted-foreground">Set to 0 for uncapped leave types (e.g. unpaid leave).</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-accrual">
                Accrual method
                <InfoTooltip text={ACCRUAL_METHOD_TOOLTIP} />
              </Label>
              <Controller
                name="accrualMethod"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    items={[
                      { value: "ANNUAL", label: ACCRUAL_LABELS.ANNUAL },
                      { value: "MONTHLY", label: ACCRUAL_LABELS.MONTHLY },
                    ]}
                  >
                    <SelectTrigger id="lt-accrual" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANNUAL">{ACCRUAL_LABELS.ANNUAL}</SelectItem>
                      <SelectItem value="MONTHLY">{ACCRUAL_LABELS.MONTHLY}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-carry-forward">Carry-forward limit</Label>
              <Input
                id="lt-carry-forward"
                type="number"
                min={0}
                step={1}
                disabled={isUncapped}
                {...register("carryForwardLimit", { valueAsNumber: true })}
              />
              {errors.carryForwardLimit && <p className="text-xs text-destructive">{errors.carryForwardLimit.message}</p>}
              <p className="text-xs text-muted-foreground">{isUncapped ? "N/A — uncapped" : "Unused days that roll over."}</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Requires approval</p>
              <p className="text-xs text-muted-foreground">If off, requests are auto-approved on submission.</p>
            </div>
            <Controller name="requiresApproval" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" />}
              {isEdit ? "Save changes" : "Add leave type"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
