import { requireAdmin } from "@/lib/require-admin";
import { AuditLogClient } from "@/components/admin/audit-log-client";

export default async function AuditLogPage() {
  await requireAdmin();
  return <AuditLogClient />;
}
