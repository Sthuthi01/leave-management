"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import type { AppSettings } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2Icon } from "lucide-react";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const schema = z.object({
  workingDays: z.array(z.number()).min(1, "Select at least one working day."),
  upcomingLeaveWindowDays: z.number().int().positive("Must be a positive number."),
  pendingApprovalUrgencyDays: z.number().int().positive("Must be a positive number."),
  auditLogDisplayLimit: z.number().int().positive("Must be a positive number."),
  sessionMaxAgeDays: z.number().int().positive("Must be a positive number."),
});

type FormValues = z.infer<typeof schema>;

export function SettingsClient() {
  const queryClient = useQueryClient();
  const { data: settings, isPending } = useQuery({ queryKey: ["settings"], queryFn: () => api.get<AppSettings>("/settings") });

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), values: settings });

  useEffect(() => {
    if (settings) reset(settings);
  }, [settings, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.patch<AppSettings>("/settings", values),
    onSuccess: (updated) => {
      toast.success("Settings saved.");
      queryClient.setQueryData(["settings"], updated);
      reset(updated);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save settings."),
  });

  return (
    <>
      <PageHeader title="Settings" description="Organization-wide configuration used across leave calculations, reports, and the audit log." />

      {isPending || !settings ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <Card>
            <CardHeader>
              <CardTitle>Working days</CardTitle>
              <CardDescription>Which days of the week count toward leave-day and holiday calculations across the app.</CardDescription>
            </CardHeader>
            <CardContent>
              <Controller
                name="workingDays"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-wrap gap-3">
                    {DAY_LABELS.map((label, dow) => {
                      const checked = field.value?.includes(dow) ?? false;
                      return (
                        <label
                          key={label}
                          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                        >
                          <Switch
                            checked={checked}
                            onCheckedChange={(next) => {
                              const set = new Set(field.value ?? []);
                              if (next) set.add(dow);
                              else set.delete(dow);
                              field.onChange([...set].sort());
                            }}
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                )}
              />
              {errors.workingDays && <p className="mt-2 text-xs text-destructive">{errors.workingDays.message}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Thresholds &amp; limits</CardTitle>
              <CardDescription>Tuning knobs used by Reports, the Audit Log, and session handling.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="upcomingLeaveWindowDays">Upcoming leave window (days)</Label>
                <Input id="upcomingLeaveWindowDays" type="number" min={1} {...register("upcomingLeaveWindowDays", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">How far ahead the &ldquo;Upcoming leave&rdquo; report looks.</p>
                {errors.upcomingLeaveWindowDays && <p className="text-xs text-destructive">{errors.upcomingLeaveWindowDays.message}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pendingApprovalUrgencyDays">Pending approval urgency (days)</Label>
                <Input id="pendingApprovalUrgencyDays" type="number" min={1} {...register("pendingApprovalUrgencyDays", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">Flags a pending approval as urgent once it&apos;s waited this long.</p>
                {errors.pendingApprovalUrgencyDays && <p className="text-xs text-destructive">{errors.pendingApprovalUrgencyDays.message}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auditLogDisplayLimit">Audit log entries shown</Label>
                <Input id="auditLogDisplayLimit" type="number" min={1} {...register("auditLogDisplayLimit", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">How many recent audit log entries are displayed.</p>
                {errors.auditLogDisplayLimit && <p className="text-xs text-destructive">{errors.auditLogDisplayLimit.message}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sessionMaxAgeDays">Session timeout (days)</Label>
                <Input id="sessionMaxAgeDays" type="number" min={1} {...register("sessionMaxAgeDays", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">How long a signed-in session stays valid before requiring sign-in again.</p>
                {errors.sessionMaxAgeDays && <p className="text-xs text-destructive">{errors.sessionMaxAgeDays.message}</p>}
              </div>
            </CardContent>
          </Card>

          <div>
            <Button type="submit" disabled={!isDirty || mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" />}
              Save changes
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
