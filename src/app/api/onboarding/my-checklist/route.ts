import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { getMyChecklist } from "@/lib/db/onboarding-repo";
import type { MyOnboardingChecklist } from "@/types";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  if (!user.onboardingChecklistId) {
    return NextResponse.json<MyOnboardingChecklist | null>(null);
  }

  const result = await getMyChecklist(user.id, user.onboardingChecklistId);
  return NextResponse.json(result ?? null);
}
