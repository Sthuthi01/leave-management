"use client";

import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import type { AccrualMethod, LeaveType } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { LeaveTypeFormDialog, ACCRUAL_LABELS, ACCRUAL_METHOD_TOOLTIP, CARRY_FORWARD_TOOLTIP } from "@/components/admin/leave-type-form-dialog";
import { LeaveTypeDot } from "@/components/leave/leave-type-badge";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusIcon, TagsIcon, PencilIcon, Trash2Icon, ChevronRightIcon, ChevronDownIcon } from "lucide-react";

export function LeaveTypesClient() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [removing, setRemoving] = useState<LeaveType | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [carryForwardDrafts, setCarryForwardDrafts] = useState<Record<string, string>>({});

  const { data: leaveTypes, isPending } = useQuery({ queryKey: ["leave-types"], queryFn: () => api.get<LeaveType[]>("/leave-types") });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/leave-types/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-types"] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update this leave type."),
  });

  const updatePolicy = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; accrualMethod?: AccrualMethod; carryForwardLimit?: number }) => api.patch(`/leave-types/${id}`, patch),
    onSuccess: () => {
      toast.success("Policy updated.");
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update this policy."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/leave-types/${id}`),
    onSuccess: () => {
      toast.success("Leave type removed.");
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
      setRemoving(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not remove this leave type."),
  });

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(lt: LeaveType) {
    setEditing(lt);
    setDialogOpen(true);
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        title="Leave Types & Policies"
        description="Define the kinds of leave employees can apply for, how each accrues, and whether it needs approval."
        actions={
          <Button onClick={openCreate}>
            <PlusIcon /> Add leave type
          </Button>
        }
      />

      <Card>
        <CardContent>
          {isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !leaveTypes || leaveTypes.length === 0 ? (
            <EmptyState icon={TagsIcon} title="No leave types yet" description="Add your first leave type to get started." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Leave type</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Days / year</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Approval
                        <InfoTooltip text="Whether requests of this type need a manager's sign-off." />
                      </span>
                    </TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Active
                        <InfoTooltip text="Inactive types are hidden from Apply Leave but keep their history." />
                      </span>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaveTypes.map((lt) => {
                    const isExpanded = expandedIds.has(lt.id);
                    const isUncapped = lt.defaultDaysPerYear === 0;
                    const carryForwardDraft = carryForwardDrafts[lt.id] ?? String(lt.carryForwardLimit);

                    return (
                      <Fragment key={lt.id}>
                        <TableRow className="cursor-pointer hover:bg-accent/40" onClick={() => toggleExpanded(lt.id)}>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={isExpanded ? `Collapse ${lt.name}` : `Expand ${lt.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpanded(lt.id);
                              }}
                            >
                              {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">
                            <span className="flex items-center gap-2">
                              <LeaveTypeDot color={lt.color} />
                              {lt.name}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{lt.code}</Badge>
                          </TableCell>
                          <TableCell>{lt.defaultDaysPerYear > 0 ? lt.defaultDaysPerYear : "Uncapped"}</TableCell>
                          <TableCell className="text-muted-foreground">{lt.requiresApproval ? "Required" : "Auto-approved"}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Switch
                              checked={lt.isActive}
                              onCheckedChange={(checked) => toggleActive.mutate({ id: lt.id, isActive: checked })}
                              aria-label={`Toggle ${lt.name} active`}
                            />
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => openEdit(lt)}>
                                <PencilIcon />
                              </Button>
                              <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRemoving(lt)} disabled={deleteMutation.isPending}>
                                <Trash2Icon />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={7} className="py-4">
                              <div className="grid max-w-xl gap-4 sm:grid-cols-2">
                                <div className="flex flex-col gap-1.5">
                                  <Label htmlFor={`accrual-${lt.id}`}>
                                    Accrual method
                                    <InfoTooltip text={ACCRUAL_METHOD_TOOLTIP} />
                                  </Label>
                                  <Select
                                    value={lt.accrualMethod}
                                    onValueChange={(v) => updatePolicy.mutate({ id: lt.id, accrualMethod: v as AccrualMethod })}
                                    items={[
                                      { value: "ANNUAL", label: ACCRUAL_LABELS.ANNUAL },
                                      { value: "MONTHLY", label: ACCRUAL_LABELS.MONTHLY },
                                    ]}
                                  >
                                    <SelectTrigger id={`accrual-${lt.id}`} className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="ANNUAL">{ACCRUAL_LABELS.ANNUAL}</SelectItem>
                                      <SelectItem value="MONTHLY">{ACCRUAL_LABELS.MONTHLY}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <Label htmlFor={`carry-forward-${lt.id}`}>
                                    Carry-forward limit
                                    <InfoTooltip text={CARRY_FORWARD_TOOLTIP} />
                                  </Label>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      id={`carry-forward-${lt.id}`}
                                      type="number"
                                      min={0}
                                      step={1}
                                      className="w-24"
                                      disabled={isUncapped}
                                      value={isUncapped ? "0" : carryForwardDraft}
                                      onChange={(e) => setCarryForwardDrafts((prev) => ({ ...prev, [lt.id]: e.target.value }))}
                                      onBlur={(e) => {
                                        const value = Math.max(0, Number(e.target.value) || 0);
                                        if (value !== lt.carryForwardLimit) updatePolicy.mutate({ id: lt.id, carryForwardLimit: value });
                                      }}
                                    />
                                    <span className="text-xs text-muted-foreground">{isUncapped ? "N/A — uncapped" : "days / year"}</span>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <LeaveTypeFormDialog open={dialogOpen} onOpenChange={setDialogOpen} leaveType={editing} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Remove leave type?"
        description={<>&ldquo;{removing?.name}&rdquo; will be permanently removed. This can&apos;t be undone — if it has any history, deactivate it instead.</>}
        confirmLabel="Remove"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => removing && deleteMutation.mutate(removing.id)}
      />
    </>
  );
}
