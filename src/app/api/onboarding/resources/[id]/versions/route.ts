import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { getResource, getResourceVersions } from "@/lib/db/onboarding-repo";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can view resource version history.");

  const { id } = await params;
  const resource = await getResource(id);
  if (!resource) return errorResponse(404, "Resource not found.");

  const versions = await getResourceVersions(id);
  return NextResponse.json(versions);
}
