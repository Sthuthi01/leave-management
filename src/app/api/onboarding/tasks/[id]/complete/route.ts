import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { getTask, setTaskCompletion } from "@/lib/db/onboarding-repo";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return errorResponse(404, "Task not found.");
  if (!user.onboardingChecklistId || task.checklistId !== user.onboardingChecklistId) {
    return errorResponse(403, "This task isn't part of your assigned checklist.");
  }

  const body = await request.json().catch(() => null);
  const completed = Boolean(body?.completed);

  await setTaskCompletion(user.id, id, completed);
  return NextResponse.json({ ok: true, completed });
}
