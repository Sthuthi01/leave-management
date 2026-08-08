import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { insertHoliday, loadSnapshot, logAudit } from "@/lib/db/repo";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  const snapshot = await loadSnapshot();
  const holidays = [...snapshot.holidays].sort((a, b) => a.date.localeCompare(b.date));
  return NextResponse.json(holidays);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can add holidays.");

  const body = await request.json().catch(() => null);
  const name = (body?.name as string | undefined)?.trim();
  const date = body?.date as string | undefined;
  const optional = Boolean(body?.optional);

  if (!name || !date || Number.isNaN(new Date(date).getTime())) {
    return errorResponse(400, "name and a valid date are required.");
  }

  const snapshot = await loadSnapshot();
  if (snapshot.holidays.some((h) => h.date === date)) {
    return errorResponse(409, "A holiday already exists on this date.");
  }

  const holiday = { id: `hol-${Date.now()}`, name, date, optional };
  await insertHoliday(holiday);
  await logAudit(user, "Added holiday", "Holiday", `${holiday.name} (${holiday.date})`);
  return NextResponse.json(holiday, { status: 201 });
}
