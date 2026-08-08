import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { logAudit } from "@/lib/db/repo";
import { checklistAssignedCount, deleteChecklist, getChecklistDetail, updateChecklist } from "@/lib/db/onboarding-repo";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can view checklist details.");

  const { id } = await params;
  const detail = await getChecklistDetail(id);
  if (!detail) return errorResponse(404, "Checklist not found.");
  return NextResponse.json(detail);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can edit onboarding checklists.");

  const { id } = await params;
  const detail = await getChecklistDetail(id);
  if (!detail) return errorResponse(404, "Checklist not found.");

  const body = await request.json().catch(() => null);
  const patch = {
    name: body?.name?.trim() ?? detail.name,
    description: body?.description !== undefined ? body.description?.trim() || null : detail.description,
    isActive: body?.isActive ?? detail.isActive,
  };
  await updateChecklist(id, patch);
  await logAudit(user, "Edited onboarding checklist", "OnboardingChecklist", patch.name);

  return NextResponse.json({ ...detail, ...patch });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can remove onboarding checklists.");

  const { id } = await params;
  const detail = await getChecklistDetail(id);
  if (!detail) return errorResponse(404, "Checklist not found.");
  const assigned = await checklistAssignedCount(id);
  if (assigned > 0) {
    return errorResponse(400, `This checklist is assigned to ${assigned} employee${assigned === 1 ? "" : "s"}. Reassign them before removing it.`);
  }

  await deleteChecklist(id);
  await logAudit(user, "Removed onboarding checklist", "OnboardingChecklist", detail.name);
  return NextResponse.json({ ok: true });
}
