"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { downloadCsv } from "@/lib/csv";
import { buildHolidayExportRows } from "@/lib/holiday-import";
import type { Holiday } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { HolidayFormDialog, HOLIDAY_TYPE_TOOLTIP } from "@/components/admin/holiday-form-dialog";
import { HolidayImportDialog } from "@/components/admin/holiday-import-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PlusIcon, PartyPopperIcon, PencilIcon, Trash2Icon, DownloadIcon, UploadIcon } from "lucide-react";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function currentYear() {
  return new Date().getFullYear();
}

export function HolidaysClient() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [removing, setRemoving] = useState<Holiday | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [year, setYear] = useState(() => currentYear());

  const { data: holidays, isPending } = useQuery({ queryKey: ["holidays"], queryFn: () => api.get<Holiday[]>("/holidays") });

  // Always offers the surrounding few years so HR can plan ahead even before any holidays exist for them.
  const yearOptions = useMemo(() => {
    const years = new Set<number>([currentYear() - 1, currentYear(), currentYear() + 1]);
    holidays?.forEach((h) => years.add(Number(h.date.slice(0, 4))));
    return Array.from(years).sort((a, b) => a - b);
  }, [holidays]);

  const filtered = useMemo(() => (holidays ?? []).filter((h) => h.date.slice(0, 4) === String(year)), [holidays, year]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/holidays/${id}`),
    onSuccess: () => {
      toast.success("Holiday removed.");
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      setRemoving(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not remove this holiday."),
  });

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(h: Holiday) {
    setEditing(h);
    setDialogOpen(true);
  }

  const today = todayISO();

  function exportHolidays(scope: "year" | "all") {
    const source = scope === "year" ? filtered : (holidays ?? []);
    if (source.length === 0) {
      toast.error("No holidays to export.");
      return;
    }
    downloadCsv(`holidays-${scope === "year" ? year : "all"}.csv`, buildHolidayExportRows(source));
  }

  return (
    <>
      <PageHeader
        title="Holidays"
        description="The company holiday calendar, used to calculate working days for leave requests."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                <DownloadIcon /> Export
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportHolidays("year")}>Export {year} ({filtered.length})</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportHolidays("all")}>Export all ({holidays?.length ?? 0})</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <UploadIcon /> Import
            </Button>
            <Button onClick={openCreate}>
              <PlusIcon /> Add holiday
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Label htmlFor="holiday-year" className="text-sm text-muted-foreground">
          Year
        </Label>
        <Select value={String(year)} onValueChange={(v) => v && setYear(Number(v))} items={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}>
          <SelectTrigger id="holiday-year" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent>
          {isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !holidays || holidays.length === 0 ? (
            <EmptyState icon={PartyPopperIcon} title="No holidays yet" description="Add your first company holiday." />
          ) : filtered.length === 0 ? (
            <EmptyState icon={PartyPopperIcon} title={`No holidays in ${year}`} description="Try a different year, or add one for this year." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Holiday</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Holiday Type
                        <InfoTooltip text={HOLIDAY_TYPE_TOOLTIP} />
                      </span>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((h) => (
                    <TableRow key={h.id} className={h.date < today ? "opacity-60" : undefined}>
                      <TableCell className="font-medium">{h.name}</TableCell>
                      <TableCell>{format(parseISO(h.date), "d MMM yyyy")}</TableCell>
                      <TableCell className="text-muted-foreground">{format(parseISO(h.date), "EEEE")}</TableCell>
                      <TableCell>
                        <Badge variant={h.optional ? "outline" : "secondary"}>{h.optional ? "Optional" : "Mandatory"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => openEdit(h)}>
                            <PencilIcon />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRemoving(h)} disabled={deleteMutation.isPending}>
                            <Trash2Icon />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <HolidayFormDialog open={dialogOpen} onOpenChange={setDialogOpen} holiday={editing} />

      <HolidayImportDialog open={importOpen} onOpenChange={setImportOpen} existingHolidays={holidays ?? []} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Remove holiday?"
        description={<>&ldquo;{removing?.name}&rdquo; will no longer be excluded from working-day calculations.</>}
        confirmLabel="Remove"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => removing && deleteMutation.mutate(removing.id)}
      />
    </>
  );
}
