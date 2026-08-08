"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { DashboardData } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";
import { HrDashboard } from "@/components/dashboard/hr-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangleIcon } from "lucide-react";

export default function DashboardPage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/dashboard"),
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={data?.kind === "HR" ? "Company-wide leave overview." : "Your leave at a glance."}
      />

      {isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangleIcon />
          <AlertTitle>Couldn&apos;t load the dashboard</AlertTitle>
          <AlertDescription>Please refresh the page.</AlertDescription>
        </Alert>
      )}

      {isPending && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}

      {data?.kind === "EMPLOYEE" && <EmployeeDashboard data={data} />}
      {data?.kind === "HR" && <HrDashboard data={data} />}
    </>
  );
}
