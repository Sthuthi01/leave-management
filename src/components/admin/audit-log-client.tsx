"use client";

import { format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { AuditLogEntry } from "@/types";
import { useAppSettings } from "@/hooks/use-app-settings";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollTextIcon } from "lucide-react";

export function AuditLogClient() {
  const { data, isPending } = useQuery({ queryKey: ["audit-log"], queryFn: () => api.get<AuditLogEntry[]>("/audit-log") });
  const { data: settings } = useAppSettings();

  return (
    <>
      <PageHeader
        title="Audit Log"
        description={`A running record of who changed what — the most recent ${settings?.auditLogDisplayLimit ?? 200} actions across the system.`}
      />

      <Card>
        <CardContent>
          {isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !data || data.length === 0 ? (
            <EmptyState icon={ScrollTextIcon} title="No activity yet" description="Actions taken across the app will show up here." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{format(parseISO(entry.timestamp), "d MMM yyyy, HH:mm")}</TableCell>
                      <TableCell className="font-medium">{entry.actorName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.action}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{entry.targetLabel}</TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground" title={entry.details ?? undefined}>
                        {entry.details ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
