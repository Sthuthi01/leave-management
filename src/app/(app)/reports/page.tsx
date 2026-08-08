import { requireAdmin } from "@/lib/require-admin";
import { ReportsClient } from "@/components/admin/reports-client";

export default async function ReportsPage() {
  await requireAdmin();
  return <ReportsClient />;
}
