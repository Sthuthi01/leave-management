import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { logAudit } from "@/lib/db/repo";
import { deleteTask, getResource, getTask, updateTask } from "@/lib/db/onboarding-repo";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can edit onboarding tasks.");

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return errorResponse(404, "Task not found.");

  const body = await request.json().catch(() => null);
  const resourceId = body?.resourceId !== undefined ? body.resourceId || null : task.resourceId;
  if (resourceId && !(await getResource(resourceId))) return errorResponse(400, "Unknown resource.");

  const patch = {
    title: body?.title?.trim() ?? task.title,
    description: body?.description !== undefined ? body.description?.trim() || null : task.description,
    resourceId,
  };
  await updateTask(id, patch);
  await logAudit(user, "Edited onboarding task", "OnboardingTask", patch.title);

  return NextResponse.json({ ...task, ...patch });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can remove onboarding tasks.");

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return errorResponse(404, "Task not found.");

  await deleteTask(id);
  await logAudit(user, "Removed onboarding task", "OnboardingTask", task.title);
  return NextResponse.json({ ok: true });
}
