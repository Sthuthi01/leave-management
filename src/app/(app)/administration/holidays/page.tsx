import { requireAdmin } from "@/lib/require-admin";
import { HolidaysClient } from "@/components/admin/holidays-client";

export default async function HolidaysPage() {
  await requireAdmin();
  return <HolidaysClient />;
}
