"use client";

import { useMemo, useState, type ElementType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { api, ApiError } from "@/lib/api-client";
import { calculateLeaveDays } from "@/lib/business-days";
import { cn } from "@/lib/utils";
import type { Holiday, LeaveBalanceSummary, LeaveRequestWithRelations, LeaveType } from "@/types";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAppSettings } from "@/hooks/use-app-settings";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { LeaveTypeDot } from "@/components/leave/leave-type-badge";
import { AlertTriangleIcon, ArrowRightIcon, CheckIcon, InfoIcon, Loader2Icon, PaperclipIcon, UploadIcon, XIcon } from "lucide-react";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(date: string) {
  return format(parseISO(date), "d MMM yyyy");
}

const schema = z
  .object({
    leaveTypeId: z.string().min(1, "Select a leave type."),
    startDate: z.string().min(1, "Start date is required."),
    endDate: z.string().min(1, "End date is required."),
    reason: z.string().trim().min(3, "Add a short reason (at least 3 characters)."),
  })
  .refine((d) => d.startDate <= d.endDate, { message: "End date must be on or after the start date.", path: ["endDate"] })
  .refine((d) => d.startDate >= todayISO(), { message: "Leave can't be applied for a date in the past.", path: ["startDate"] });

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function InlineNotice({ tone, icon: Icon, children }: { tone: "warning" | "destructive"; icon: ElementType; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-2.5 py-2 text-xs",
        tone === "warning" && "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
        tone === "destructive" && "bg-destructive/10 text-destructive"
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

type StepState = "done" | "current" | "blocked" | "future";

function ApprovalTimeline({ steps }: { steps: { label: string; sub?: string; state: StepState }[] }) {
  return (
    <div className="flex flex-col">
      {steps.map((step, i) => (
        <div key={step.label} className="flex gap-2.5">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full",
                step.state === "done" && "bg-primary text-primary-foreground",
                step.state === "current" && "border-2 border-primary bg-background",
                step.state === "blocked" && "bg-destructive/15 text-destructive",
                step.state === "future" && "border border-border bg-background"
              )}
            >
              {step.state === "done" && <CheckIcon className="size-3" />}
            </div>
            {i < steps.length - 1 && <div className={cn("my-0.5 w-px flex-1", step.state === "done" ? "bg-primary" : "bg-border")} />}
          </div>
          <div className={cn("flex flex-col", i < steps.length - 1 ? "pb-3" : "")}>
            <span className="text-xs font-medium">{step.label}</span>
            {step.sub && <span className="text-[11px] text-muted-foreground">{step.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leave balance strip
// ---------------------------------------------------------------------------

function BalanceStrip({ leaveTypeId, previewDays }: { leaveTypeId: string; previewDays: number }) {
  const { data: balances, isPending } = useQuery({
    queryKey: ["leave-balances"],
    queryFn: () => api.get<LeaveBalanceSummary[]>("/leave-balances"),
  });

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {isPending && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[128px] rounded-xl" />)}

      {balances?.map((b) => {
        const isSelected = b.leaveType.id === leaveTypeId && previewDays > 0;
        const overBudget = isSelected && b.allocated > 0 && previewDays > b.remaining;
        const previewRemaining = isSelected ? Math.max(0, b.remaining - previewDays) : b.remaining;
        const pct = b.allocated > 0 ? Math.min(100, Math.round(((b.used + (isSelected ? previewDays : 0)) / b.allocated) * 100)) : 0;

        return (
          <Card
            key={b.leaveType.id}
            className={cn("transition-shadow", isSelected && (overBudget ? "ring-2 ring-destructive" : "ring-2 ring-primary"))}
          >
            <CardContent className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-1">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <LeaveTypeDot color={b.leaveType.color} />
                  <span className="truncate">{b.leaveType.name}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {b.carriedForward > 0 && (
                    <Tooltip>
                      <TooltipTrigger className="outline-none">
                        <Badge variant="secondary" className="px-1.5 text-[10px]">
                          +{b.carriedForward}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>Days rolled over from last year.</TooltipContent>
                    </Tooltip>
                  )}
                  <Badge variant="outline" className="px-1.5 text-[10px]">
                    {b.leaveType.code}
                  </Badge>
                </div>
              </div>

              <div className="flex items-baseline gap-1.5">
                {isSelected ? (
                  <>
                    <span className="text-base font-medium text-muted-foreground line-through">{b.remaining}</span>
                    <ArrowRightIcon className="size-3.5 text-muted-foreground" />
                    <span className={cn("text-2xl font-semibold", overBudget ? "text-destructive" : "text-foreground")}>{previewRemaining}</span>
                  </>
                ) : (
                  <span className="text-2xl font-semibold">{b.remaining}</span>
                )}
                <span className="text-xs text-muted-foreground">days left</span>
              </div>

              {b.allocated > 0 ? (
                <>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full transition-all", overBudget && "bg-destructive")}
                      style={{ width: `${pct}%`, ...(overBudget ? {} : { backgroundColor: b.leaveType.color }) }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{b.used} used</span>
                    <span>{b.allocated} total</span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No annual cap</p>
              )}

              {overBudget && <p className="text-[11px] font-medium text-destructive">Only {b.remaining} available</p>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function ApplyLeavePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const { data: leaveTypes } = useQuery({ queryKey: ["leave-types"], queryFn: () => api.get<LeaveType[]>("/leave-types") });
  const { data: holidays } = useQuery({ queryKey: ["holidays"], queryFn: () => api.get<Holiday[]>("/holidays") });
  const { data: settings } = useAppSettings();
  const { data: balances } = useQuery({ queryKey: ["leave-balances"], queryFn: () => api.get<LeaveBalanceSummary[]>("/leave-balances") });
  const [document, setDocument] = useState<File | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { leaveTypeId: "", startDate: "", endDate: "", reason: "" },
  });

  const [leaveTypeId, startDate, endDate] = watch(["leaveTypeId", "startDate", "endDate"]);
  const selectedType = leaveTypes?.find((t) => t.id === leaveTypeId);
  const selectedBalance = balances?.find((b) => b.leaveType.id === leaveTypeId);
  const hasManager = !!user?.managerId;

  const previewDays = useMemo(() => {
    if (!startDate || !endDate || !holidays || startDate > endDate) return 0;
    return calculateLeaveDays(startDate, endDate, holidays, settings?.workingDays);
  }, [startDate, endDate, holidays, settings]);

  const insufficientBalance = !!selectedBalance && selectedBalance.allocated > 0 && previewDays > selectedBalance.remaining;
  const needsDocument = selectedType?.code === "SL" && previewDays > 2;

  const policyHints = useMemo(() => {
    if (!selectedType) return [];
    const hints: string[] = [];
    if (selectedType.accrualMethod === "MONTHLY") {
      hints.push("This leave type accrues monthly, so your full annual balance may not be available yet.");
    }
    if (selectedType.carryForwardLimit > 0) {
      hints.push(`Up to ${selectedType.carryForwardLimit} unused day${selectedType.carryForwardLimit === 1 ? "" : "s"} carry forward into next year.`);
    }
    return hints;
  }, [selectedType]);

  const approvalSteps = useMemo((): { label: string; sub?: string; state: StepState }[] => {
    if (!selectedType) return [];
    if (!selectedType.requiresApproval) {
      return [
        { label: "Submitted", sub: "by you", state: "done" },
        { label: "Auto-approved", sub: "No sign-off needed for this leave type", state: "done" },
      ];
    }
    return [
      { label: "Submitted", sub: "by you", state: "done" },
      {
        label: "Manager review",
        sub: hasManager ? (user?.manager?.name ?? "Your manager") : "No manager assigned",
        state: hasManager ? "current" : "blocked",
      },
      { label: "Approved", state: "future" },
    ];
  }, [selectedType, hasManager, user]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post<LeaveRequestWithRelations>("/leave-requests", values),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success(`${created.referenceNumber} submitted`, {
        description: created.status === "APPROVED" ? "Auto-approved — no sign-off required for this leave type." : "Sent to your manager for approval.",
      });
      reset();
      setDocument(null);
      router.push("/leave/my-leaves");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    },
  });

  const activeLeaveTypes = leaveTypes?.filter((t) => t.isActive) ?? [];

  return (
    <>
      <PageHeader title="Apply Leave" description="Submit a new leave request and preview its impact before you send it." />

      <div className="flex flex-col gap-4">
        <BalanceStrip leaveTypeId={leaveTypeId} previewDays={previewDays} />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card size="sm" className="lg:col-span-2">
            <CardContent>
              {!hasManager && (
                <div className="mb-3">
                  <InlineNotice tone="warning" icon={InfoIcon}>
                    No manager on file — requests that need approval will fail until HR assigns you one.
                  </InlineNotice>
                </div>
              )}

              <form className="flex flex-col gap-3.5" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leaveTypeId">Leave type</Label>
                  <Controller
                    name="leaveTypeId"
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        items={activeLeaveTypes.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))}
                      >
                        <SelectTrigger id="leaveTypeId" className="w-full">
                          <SelectValue placeholder="Select a leave type" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeLeaveTypes.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              <LeaveTypeDot color={t.color} /> {t.name} ({t.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.leaveTypeId && <p className="text-xs text-destructive">{errors.leaveTypeId.message}</p>}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="startDate">Start Date</Label>
                    <Input
                      id="startDate"
                      type="date"
                      min={todayISO()}
                      {...register("startDate", {
                        onChange: (e) => {
                          // Keep the end date from silently sitting before a newly-picked start date.
                          if (endDate && e.target.value > endDate) setValue("endDate", e.target.value, { shouldValidate: true });
                        },
                      })}
                    />
                    {errors.startDate && <p className="text-xs text-destructive">{errors.startDate.message}</p>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="endDate">End Date</Label>
                    <Input id="endDate" type="date" min={startDate || todayISO()} {...register("endDate")} />
                    {errors.endDate && <p className="text-xs text-destructive">{errors.endDate.message}</p>}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reason">Reason</Label>
                  <Textarea id="reason" rows={3} placeholder="Let your manager know why you're taking this leave." {...register("reason")} />
                  {errors.reason && <p className="text-xs text-destructive">{errors.reason.message}</p>}
                </div>

                {needsDocument && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="document">
                      Supporting document <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    {document ? (
                      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <PaperclipIcon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{document.name}</span>
                        </span>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove file" onClick={() => setDocument(null)}>
                          <XIcon />
                        </Button>
                      </div>
                    ) : (
                      <label
                        htmlFor="document"
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50"
                      >
                        <UploadIcon className="size-4 shrink-0" />
                        Attach a medical certificate or note
                        <input
                          id="document"
                          type="file"
                          className="hidden"
                          accept="image/*,.pdf"
                          onChange={(e) => setDocument(e.target.files?.[0] ?? null)}
                        />
                      </label>
                    )}
                    <p className="text-[11px] text-muted-foreground">Recommended for sick leave longer than 2 days — not required to submit.</p>
                  </div>
                )}

                {insufficientBalance && selectedBalance && (
                  <InlineNotice tone="destructive" icon={AlertTriangleIcon}>
                    This request needs {previewDays} day{previewDays === 1 ? "" : "s"}, but only {selectedBalance.remaining} day
                    {selectedBalance.remaining === 1 ? "" : "s"} of {selectedBalance.leaveType.name} remain.
                  </InlineNotice>
                )}

                {mutation.isError && (
                  <InlineNotice tone="destructive" icon={AlertTriangleIcon}>
                    {mutation.error instanceof ApiError ? mutation.error.message : "Couldn't submit this request. Please try again."}
                  </InlineNotice>
                )}

                <div>
                  <Button type="submit" disabled={isSubmitting || mutation.isPending || insufficientBalance}>
                    {(isSubmitting || mutation.isPending) && <Loader2Icon className="animate-spin" />}
                    Submit request
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm font-semibold">Summary</p>

              {!selectedType ? (
                <p className="text-sm text-muted-foreground">Select a leave type and dates to preview your request.</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <LeaveTypeDot color={selectedType.color} />
                    <span className="text-sm font-medium">{selectedType.name}</span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Duration</span>
                    <span className="font-medium">{previewDays > 0 ? `${previewDays} day${previewDays === 1 ? "" : "s"}` : "—"}</span>
                  </div>
                  {startDate && endDate && (
                    <div className="-mt-2 flex justify-end">
                      <span className="text-xs text-muted-foreground">
                        {fmt(startDate)} – {fmt(endDate)}
                      </span>
                    </div>
                  )}

                  {selectedBalance && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Balance after</span>
                      <span className={cn("font-medium", insufficientBalance && "text-destructive")}>
                        {selectedBalance.allocated > 0
                          ? `${Math.max(0, selectedBalance.remaining - previewDays)} of ${selectedBalance.allocated} days`
                          : "No annual cap"}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Approver</span>
                    <span className="font-medium">
                      {selectedType.requiresApproval ? (hasManager ? (user?.manager?.name ?? "Your manager") : "Not assigned") : "None needed"}
                    </span>
                  </div>

                  <div className="border-t border-border pt-3">
                    <ApprovalTimeline steps={approvalSteps} />
                  </div>

                  {policyHints.length > 0 && (
                    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                      {policyHints.map((hint) => (
                        <p key={hint} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                          <InfoIcon className="mt-0.5 size-3 shrink-0" /> {hint}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}

              <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
                Weekends and company holidays are automatically excluded from the day count.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
