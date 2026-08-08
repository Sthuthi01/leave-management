import { requireAdmin } from "@/lib/require-admin";
import { OnboardingClient } from "@/components/admin/onboarding-client";

export default async function AdminOnboardingPage() {
  await requireAdmin();
  return <OnboardingClient />;
}
