import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { deleteHoliday, loadSnapshot, logAudit, updateHoliday } from "@/lib/db/repo";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can edit holidays.");

  const { id } = await params;
  const snapshot = await loadSnapshot();
  const holiday = snapshot.holidays.find((h) => h.id === id);
  if (!holiday) return errorResponse(404, "Holiday not found.");

  const body = await request.json().catch(() => null);
  if (body?.date && Number.isNaN(new Date(body.date).getTime())) return errorResponse(400, "Invalid date.");

  const nextDate = body?.date ?? holiday.date;
  if (snapshot.holidays.some((h) => h.id !== id && h.date === nextDate)) {
    return errorResponse(409, "A holiday already exists on this date.");
  }

  const patch = {
    name: body?.name?.trim() ?? holiday.name,
    date: nextDate,
    optional: body?.optional ?? holiday.optional,
  };
  await updateHoliday(id, patch);
  await logAudit(user, "Edited holiday", "Holiday", `${patch.name} (${patch.date})`);

  return NextResponse.json({ ...holiday, ...patch });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can remove holidays.");

  const { id } = await params;
  const snapshot = await loadSnapshot();
  const holiday = snapshot.holidays.find((h) => h.id === id);
  if (!holiday) return errorResponse(404, "Holiday not found.");

  await deleteHoliday(id);
  await logAudit(user, "Removed holiday", "Holiday", `${holiday.name} (${holiday.date})`);
  return NextResponse.json({ ok: true });
}
