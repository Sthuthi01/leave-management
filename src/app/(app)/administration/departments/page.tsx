import { requireAdmin } from "@/lib/require-admin";
import { DepartmentsClient } from "@/components/admin/departments-client";

export default async function DepartmentsPage() {
  await requireAdmin();
  return <DepartmentsClient />;
}
