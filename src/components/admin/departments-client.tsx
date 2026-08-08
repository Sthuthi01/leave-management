"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import type { Department, EmployeeWithRelations } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DepartmentFormDialog } from "@/components/admin/department-form-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusIcon, BuildingIcon, PencilIcon, Trash2Icon } from "lucide-react";

export function DepartmentsClient() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [removing, setRemoving] = useState<Department | null>(null);

  const { data: departments, isPending } = useQuery({ queryKey: ["departments"], queryFn: () => api.get<Department[]>("/departments") });
  const { data: employees } = useQuery({ queryKey: ["employees"], queryFn: () => api.get<EmployeeWithRelations[]>("/employees") });

  const employeeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    employees?.filter((e) => e.status === "ACTIVE").forEach((e) => counts.set(e.departmentId, (counts.get(e.departmentId) ?? 0) + 1));
    return counts;
  }, [employees]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}`),
    onSuccess: () => {
      toast.success("Department removed.");
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      setRemoving(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not remove this department."),
  });

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(d: Department) {
    setEditing(d);
    setDialogOpen(true);
  }

  return (
    <>
      <PageHeader
        title="Departments"
        description="The departments employees can belong to, used across the employee directory and reports."
        actions={
          <Button onClick={openCreate}>
            <PlusIcon /> Add department
          </Button>
        }
      />

      <Card>
        <CardContent>
          {isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !departments || departments.length === 0 ? (
            <EmptyState icon={BuildingIcon} title="No departments yet" description="Add your first department to get started." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Employees</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{employeeCounts.get(d.id) ?? 0} employees</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => openEdit(d)}>
                          <PencilIcon />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRemoving(d)} disabled={deleteMutation.isPending}>
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DepartmentFormDialog open={dialogOpen} onOpenChange={setDialogOpen} department={editing} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Remove department?"
        description={<>&ldquo;{removing?.name}&rdquo; can only be removed once no employees are assigned to it.</>}
        confirmLabel="Remove"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => removing && deleteMutation.mutate(removing.id)}
      />
    </>
  );
}
