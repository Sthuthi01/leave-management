"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import type { Holiday } from "@/types";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Loader2Icon } from "lucide-react";

export const HOLIDAY_TYPE_TOOLTIP =
  "Mandatory holidays apply company-wide. Optional holidays are typically regional or festival-specific. Both are excluded from working-day calculations the same way.";

const schema = z.object({
  name: z.string().trim().min(2, "Name is required."),
  date: z.string().min(1, "Date is required."),
  optional: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export function HolidayFormDialog({ open, onOpenChange, holiday }: { open: boolean; onOpenChange: (open: boolean) => void; holiday: Holiday | null }) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(holiday);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "", date: "", optional: false } });

  useEffect(() => {
    if (open) {
      reset(holiday ? { name: holiday.name, date: holiday.date, optional: holiday.optional } : { name: "", date: "", optional: false });
    }
  }, [open, holiday, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => (isEdit ? api.patch(`/holidays/${holiday!.id}`, values) : api.post("/holidays", values)),
    onSuccess: () => {
      toast.success(isEdit ? "Holiday updated." : "Holiday added.");
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit holiday" : "Add holiday"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update this holiday." : "Add a company holiday to the calendar."}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hol-name">Name</Label>
            <Input id="hol-name" placeholder="e.g. Independence Day" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hol-date">Date</Label>
            <Input id="hol-date" type="date" {...register("date")} />
            {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="flex items-center gap-1 text-sm font-medium">
                Optional holiday
                <InfoTooltip text={HOLIDAY_TYPE_TOOLTIP} />
              </p>
              <p className="text-xs text-muted-foreground">
                Marks it as a regional or festival holiday rather than a company-wide one. It&apos;s still excluded from working-day calculations for everyone.
              </p>
            </div>
            <Controller name="optional" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" />}
              {isEdit ? "Save changes" : "Add holiday"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
