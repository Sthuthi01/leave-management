import { requireAdmin } from "@/lib/require-admin";
import { SettingsClient } from "@/components/admin/settings-client";

export default async function AdminSettingsPage() {
  await requireAdmin();
  return <SettingsClient />;
}
