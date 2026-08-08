import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return errorResponse(401, "Not signed in.");
  return NextResponse.json(user);
}
