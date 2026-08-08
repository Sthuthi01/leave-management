import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { insertHoliday, loadSnapshot, logAudit } from "@/lib/db/repo";

const MAX_ROWS = 500;

interface ImportRowInput {
  name?: string;
  date?: string;
  optional?: boolean;
}

interface ImportRowResult {
  index: number;
  status: "created" | "skipped";
  message?: string;
}

/**
 * Bulk equivalent of POST /api/holidays — re-runs the same per-row checks that route enforces
 * (valid date, no two holidays sharing a date) rather than trusting the client's own validation,
 * since the request body is untrusted input.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can import holidays.");

  const body = await request.json().catch(() => null);
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return errorResponse(400, "rows must be a non-empty array.");
  if (rows.length > MAX_ROWS) return errorResponse(400, `A single import can contain at most ${MAX_ROWS} rows.`);

  const snapshot = await loadSnapshot();
  const results: ImportRowResult[] = [];
  let created = 0;

  for (let index = 0; index < rows.length; index++) {
    const row = (rows[index] ?? {}) as ImportRowInput;
    const name = row.name?.trim();
    const date = row.date;
    const optional = Boolean(row.optional);

    if (!name || !date || Number.isNaN(new Date(date).getTime())) {
      results.push({ index, status: "skipped", message: "Missing required fields." });
      continue;
    }
    if (snapshot.holidays.some((h) => h.date === date)) {
      results.push({ index, status: "skipped", message: "A holiday already exists on this date." });
      continue;
    }

    const holiday = { id: `hol-${Date.now()}-${index}`, name, date, optional };
    await insertHoliday(holiday);
    await logAudit(user, "Added holiday", "Holiday", `${holiday.name} (${holiday.date})`);
    snapshot.holidays.push(holiday);
    created++;
    results.push({ index, status: "created" });
  }

  return NextResponse.json({ created, skipped: results.length - created, results });
}
