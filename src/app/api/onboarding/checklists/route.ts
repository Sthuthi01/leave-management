import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { logAudit } from "@/lib/db/repo";
import { insertChecklist, listChecklists } from "@/lib/db/onboarding-repo";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  return NextResponse.json(await listChecklists());
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can add onboarding checklists.");

  const body = await request.json().catch(() => null);
  const name = (body?.name as string | undefined)?.trim();
  const description = (body?.description as string | undefined)?.trim() || null;
  if (!name) return errorResponse(400, "name is required.");

  const checklist = await insertChecklist({ name, description });
  await logAudit(user, "Added onboarding checklist", "OnboardingChecklist", checklist.name);
  return NextResponse.json(checklist, { status: 201 });
}
