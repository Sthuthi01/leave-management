import { requireAdmin } from "@/lib/require-admin";
import { EmployeesClient } from "@/components/admin/employees-client";

export default async function EmployeesPage() {
  await requireAdmin();
  return <EmployeesClient />;
}
