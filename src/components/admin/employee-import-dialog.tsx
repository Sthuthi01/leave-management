"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { downloadCsv } from "@/lib/csv";
import {
  EMPLOYEE_IMPORT_COLUMNS,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  buildImportTemplateRows,
  parseEmployeeImportFile,
  validateImportRows,
  type EmployeeImportRowResult,
} from "@/lib/employee-import";
import type { Department, EmployeeWithRelations, OnboardingChecklist } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2Icon, DownloadIcon, UploadIcon, FileSpreadsheetIcon, CheckCircle2Icon, AlertTriangleIcon } from "lucide-react";

const ACCEPTED_FILE_TYPES =
  ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

export function EmployeeImportDialog({
  open,
  onOpenChange,
  departments,
  employees,
  checklists,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: Department[];
  employees: EmployeeWithRelations[];
  checklists: OnboardingChecklist[];
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<EmployeeImportRowResult[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  const validRows = rows?.filter((r) => r.data !== null) ?? [];
  const invalidRows = rows?.filter((r) => r.data === null) ?? [];

  function reset() {
    setFileName(null);
    setParsing(false);
    setParseError(null);
    setRows(null);
    setConfirming(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function downloadTemplate() {
    downloadCsv("employee-import-template.csv", buildImportTemplateRows(departments[0]?.name));
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setRows(null);

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setParseError(`This file is too large. The limit is ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))}MB.`);
      return;
    }

    setParsing(true);
    try {
      const rawRows = await parseEmployeeImportFile(file);
      const requiredHeaders = [EMPLOYEE_IMPORT_COLUMNS.name, EMPLOYEE_IMPORT_COLUMNS.email];
      const headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
      const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));

      if (rawRows.length === 0) {
        setParseError("No rows found in this file.");
      } else if (missingHeaders.length > 0) {
        setParseError(
          `This file doesn't match the template — missing column${missingHeaders.length > 1 ? "s" : ""}: ${missingHeaders.join(", ")}. Download the template below to see the expected format.`
        );
      } else if (rawRows.length > MAX_IMPORT_ROWS) {
        setParseError(`This file has ${rawRows.length} rows — the limit per import is ${MAX_IMPORT_ROWS}.`);
      } else {
        setRows(validateImportRows(rawRows, { departments, employees, checklists }));
      }
    } catch {
      setParseError("Couldn't read this file. Make sure it's a valid .csv or .xlsx file.");
    } finally {
      setParsing(false);
    }
  }

  const importMutation = useMutation({
    mutationFn: () =>
      api.post<{ created: number; skipped: number }>("/employees/import", {
        rows: validRows.map((r) => r.data),
      }),
    onSuccess: (res) => {
      toast.success(`Imported ${res.created} employee${res.created === 1 ? "" : "s"}.${res.skipped > 0 ? ` ${res.skipped} skipped.` : ""}`);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setConfirming(false);
      handleClose(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Import failed.");
      setConfirming(false);
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import employees</DialogTitle>
            <DialogDescription>Bulk-add employees from a CSV or Excel file. Download the template to see the expected columns.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={downloadTemplate}>
                <DownloadIcon /> Download template
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={ACCEPTED_FILE_TYPES}
                onChange={handleFileChange}
              />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <UploadIcon /> {fileName ? "Choose a different file" : "Choose file"}
              </Button>
              {fileName && (
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                  <FileSpreadsheetIcon className="size-4 shrink-0" />
                  <span className="truncate">{fileName}</span>
                </span>
              )}
            </div>

            {parsing && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> Reading file…
              </p>
            )}

            {parseError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                <p>{parseError}</p>
              </div>
            )}

            {rows && rows.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2Icon className="size-4" /> {validRows.length} ready to import
                  </span>
                  {invalidRows.length > 0 && (
                    <span className="flex items-center gap-1.5 font-medium text-destructive">
                      <AlertTriangleIcon className="size-4" /> {invalidRows.length} with errors (will be skipped)
                    </span>
                  )}
                </div>

                <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">Row</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.rowNumber}>
                          <TableCell className="text-muted-foreground">{r.rowNumber}</TableCell>
                          <TableCell>{r.raw[EMPLOYEE_IMPORT_COLUMNS.name] || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{r.raw[EMPLOYEE_IMPORT_COLUMNS.email] || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{r.raw[EMPLOYEE_IMPORT_COLUMNS.department] || "—"}</TableCell>
                          <TableCell className="whitespace-normal">
                            {r.errors.length === 0 ? (
                              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400">Ready</Badge>
                            ) : (
                              <div className="flex flex-col gap-1">
                                <Badge variant="destructive">Error</Badge>
                                {r.errors.map((err, i) => (
                                  <p key={i} className="text-xs text-destructive">
                                    {err}
                                  </p>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="button" disabled={validRows.length === 0 || importMutation.isPending} onClick={() => setConfirming(true)}>
              Import {validRows.length > 0 ? `${validRows.length} employee${validRows.length === 1 ? "" : "s"}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Import employees?"
        description={
          <>
            This will add <strong>{validRows.length}</strong> new employee{validRows.length === 1 ? "" : "s"} to the directory.
            {invalidRows.length > 0 && (
              <>
                {" "}
                <strong>{invalidRows.length}</strong> row{invalidRows.length === 1 ? "" : "s"} with errors will be skipped.
              </>
            )}{" "}
            This can&apos;t be undone in bulk — you&apos;d need to deactivate or edit each person individually.
          </>
        }
        confirmLabel="Import"
        pending={importMutation.isPending}
        onConfirm={() => importMutation.mutate()}
      />
    </>
  );
}
