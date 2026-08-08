import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { logAudit } from "@/lib/db/repo";
import { checklistExists, getResource, insertTask } from "@/lib/db/onboarding-repo";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can add onboarding tasks.");

  const { id: checklistId } = await params;
  if (!(await checklistExists(checklistId))) return errorResponse(404, "Checklist not found.");

  const body = await request.json().catch(() => null);
  const title = (body?.title as string | undefined)?.trim();
  const description = (body?.description as string | undefined)?.trim() || null;
  const resourceId = (body?.resourceId as string | undefined) || null;
  if (!title) return errorResponse(400, "title is required.");
  if (resourceId && !(await getResource(resourceId))) return errorResponse(400, "Unknown resource.");

  const task = await insertTask({ checklistId, title, description, resourceId });
  await logAudit(user, "Added onboarding task", "OnboardingTask", title);
  return NextResponse.json(task, { status: 201 });
}
