import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { loadSnapshot, logAudit } from "@/lib/db/repo";
import { insertResource, listResources } from "@/lib/db/onboarding-repo";
import type { AudienceScope, ResourceCategory, ResourceStatus, Role } from "@/types";

const CATEGORIES: ResourceCategory[] = ["GUIDE", "POLICY", "TRAINING"];
const STATUSES: ResourceStatus[] = ["DRAFT", "PUBLISHED"];
const AUDIENCE_SCOPES: AudienceScope[] = ["ALL", "DEPARTMENT", "ROLE"];
const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "ADMIN"];

function parseAttachments(body: unknown): { name: string; url: string }[] | null {
  if (!Array.isArray(body)) return [];
  const attachments: { name: string; url: string }[] = [];
  for (const item of body) {
    const name = (item?.name as string | undefined)?.trim();
    const url = (item?.url as string | undefined)?.trim();
    if (!name && !url) continue; // skip blank rows left over from the dynamic form
    if (!name || !url) return null;
    attachments.push({ name, url });
  }
  return attachments;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  const resources = await listResources(user.role === "ADMIN" ? null : { departmentId: user.departmentId, role: user.role });
  return NextResponse.json(resources);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can add onboarding resources.");

  const body = await request.json().catch(() => null);
  const title = (body?.title as string | undefined)?.trim();
  const category = body?.category as ResourceCategory | undefined;
  const description = (body?.description as string | undefined)?.trim();
  const content = (body?.content as string | undefined)?.trim() || null;
  const url = (body?.url as string | undefined)?.trim() || null;
  const status = (body?.status as ResourceStatus | undefined) ?? "DRAFT";
  const isRequired = Boolean(body?.isRequired);
  const audienceScope = (body?.audienceScope as AudienceScope | undefined) ?? "ALL";
  const audienceDepartmentId = (body?.audienceDepartmentId as string | undefined) || null;
  const audienceRole = (body?.audienceRole as Role | undefined) || null;
  const effectiveDate = (body?.effectiveDate as string | undefined) || null;
  const attachments = parseAttachments(body?.attachments);

  if (!title || !description) return errorResponse(400, "title and description are required.");
  if (!category || !CATEGORIES.includes(category)) return errorResponse(400, "category must be GUIDE, POLICY or TRAINING.");
  if (!STATUSES.includes(status)) return errorResponse(400, "status must be DRAFT or PUBLISHED.");
  if (!AUDIENCE_SCOPES.includes(audienceScope)) return errorResponse(400, "audienceScope must be ALL, DEPARTMENT or ROLE.");
  if (attachments === null) return errorResponse(400, "Each attachment needs both a name and a URL.");

  if (audienceScope === "DEPARTMENT") {
    if (!audienceDepartmentId) return errorResponse(400, "Select a department for this audience.");
    const snapshot = await loadSnapshot();
    if (!snapshot.departments.some((d) => d.id === audienceDepartmentId)) return errorResponse(400, "Unknown department.");
  }
  if (audienceScope === "ROLE") {
    if (!audienceRole || !ROLES.includes(audienceRole)) return errorResponse(400, "Select a role for this audience.");
  }

  const resource = await insertResource({
    title,
    category,
    description,
    content,
    url,
    status,
    isRequired,
    audienceScope,
    audienceDepartmentId: audienceScope === "DEPARTMENT" ? audienceDepartmentId : null,
    audienceRole: audienceScope === "ROLE" ? audienceRole : null,
    effectiveDate,
    attachments,
  });
  await logAudit(user, "Added onboarding resource", "OnboardingResource", resource.title);
  return NextResponse.json(resource, { status: 201 });
}
