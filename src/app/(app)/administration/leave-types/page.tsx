import { requireAdmin } from "@/lib/require-admin";
import { LeaveTypesClient } from "@/components/admin/leave-types-client";

export default async function LeaveTypesPage() {
  await requireAdmin();
  return <LeaveTypesClient />;
}
