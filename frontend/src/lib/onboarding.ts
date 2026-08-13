import type { OnboardingResource, ResourceEffectiveState } from "../types";

/** A resource's real-world visibility, folding its Draft/Published status together with its
 * effective date — exact port of the source app's src/lib/onboarding.ts resourceEffectiveState,
 * used here purely for the admin table's status badge (the server already enforces the real
 * visibility rule; this is display-only). */
export function resourceEffectiveState(resource: Pick<OnboardingResource, "status" | "effective_date">): ResourceEffectiveState {
  if (resource.status === "DRAFT") return "DRAFT";
  const today = new Date().toISOString().slice(0, 10);
  if (resource.effective_date && resource.effective_date > today) return "SCHEDULED";
  return "LIVE";
}
