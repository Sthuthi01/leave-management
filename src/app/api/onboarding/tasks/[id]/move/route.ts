import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { getTask, moveTask } from "@/lib/db/onboarding-repo";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can reorder onboarding tasks.");

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return errorResponse(404, "Task not found.");

  const body = await request.json().catch(() => null);
  const direction = body?.direction as "up" | "down" | undefined;
  if (direction !== "up" && direction !== "down") return errorResponse(400, "direction must be 'up' or 'down'.");

  await moveTask(id, direction);
  return NextResponse.json({ ok: true });
}
