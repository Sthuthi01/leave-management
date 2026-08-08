import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { loadSnapshot, logAudit } from "@/lib/db/repo";
import { deleteResource, getResource, resourceInUseByTasks, updateResource } from "@/lib/db/onboarding-repo";
import type { AudienceScope, ResourceCategory, ResourceStatus, Role } from "@/types";

const CATEGORIES: ResourceCategory[] = ["GUIDE", "POLICY", "TRAINING"];
const STATUSES: ResourceStatus[] = ["DRAFT", "PUBLISHED"];
const AUDIENCE_SCOPES: AudienceScope[] = ["ALL", "DEPARTMENT", "ROLE"];
const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "ADMIN"];

function parseAttachments(body: unknown): { name: string; url: string }[] | null | undefined {
  if (body === undefined) return undefined;
  if (!Array.isArray(body)) return [];
  const attachments: { name: string; url: string }[] = [];
  for (const item of body) {
    const name = (item?.name as string | undefined)?.trim();
    const url = (item?.url as string | undefined)?.trim();
    if (!name && !url) continue;
    if (!name || !url) return null;
    attachments.push({ name, url });
  }
  return attachments;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can edit onboarding resources.");

  const { id } = await params;
  const resource = await getResource(id);
  if (!resource) return errorResponse(404, "Resource not found.");

  const body = await request.json().catch(() => null);
  if (body?.category !== undefined && !CATEGORIES.includes(body.category)) {
    return errorResponse(400, "category must be GUIDE, POLICY or TRAINING.");
  }
  if (body?.status !== undefined && !STATUSES.includes(body.status)) {
    return errorResponse(400, "status must be DRAFT or PUBLISHED.");
  }
  if (body?.audienceScope !== undefined && !AUDIENCE_SCOPES.includes(body.audienceScope)) {
    return errorResponse(400, "audienceScope must be ALL, DEPARTMENT or ROLE.");
  }

  const audienceScope: AudienceScope = body?.audienceScope ?? resource.audienceScope;
  const audienceDepartmentId = body?.audienceDepartmentId !== undefined ? body.audienceDepartmentId || null : resource.audienceDepartmentId;
  const audienceRole = body?.audienceRole !== undefined ? body.audienceRole || null : resource.audienceRole;

  if (audienceScope === "DEPARTMENT") {
    if (!audienceDepartmentId) return errorResponse(400, "Select a department for this audience.");
    const snapshot = await loadSnapshot();
    if (!snapshot.departments.some((d) => d.id === audienceDepartmentId)) return errorResponse(400, "Unknown department.");
  }
  if (audienceScope === "ROLE" && (!audienceRole || !ROLES.includes(audienceRole))) {
    return errorResponse(400, "Select a role for this audience.");
  }

  const attachments = parseAttachments(body?.attachments);
  if (attachments === null) return errorResponse(400, "Each attachment needs both a name and a URL.");

  const patch = {
    title: body?.title?.trim() ?? resource.title,
    category: body?.category ?? resource.category,
    description: body?.description?.trim() ?? resource.description,
    content: body?.content !== undefined ? body.content?.trim() || null : resource.content,
    url: body?.url !== undefined ? body.url?.trim() || null : resource.url,
    status: body?.status ?? resource.status,
    isRequired: body?.isRequired !== undefined ? Boolean(body.isRequired) : resource.isRequired,
    audienceScope,
    audienceDepartmentId: audienceScope === "DEPARTMENT" ? audienceDepartmentId : null,
    audienceRole: audienceScope === "ROLE" ? audienceRole : null,
    effectiveDate: body?.effectiveDate !== undefined ? body.effectiveDate || null : resource.effectiveDate,
    attachments,
  };
  await updateResource(id, patch, { id: user.id, name: user.name });
  await logAudit(user, "Edited onboarding resource", "OnboardingResource", patch.title);

  return NextResponse.json({ ...resource, ...patch, attachments: attachments ?? resource.attachments });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can remove onboarding resources.");

  const { id } = await params;
  const resource = await getResource(id);
  if (!resource) return errorResponse(404, "Resource not found.");
  if (await resourceInUseByTasks(id)) {
    return errorResponse(400, "This resource is linked to onboarding tasks. Set it to Draft instead of removing it.");
  }

  await deleteResource(id);
  await logAudit(user, "Removed onboarding resource", "OnboardingResource", resource.title);
  return NextResponse.json({ ok: true });
}
