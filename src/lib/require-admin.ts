import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import type { EmployeeWithRelations } from "@/types";

/** Call from an (app) server page. The layout already guarantees a signed-in user. */
export async function requireAdmin(): Promise<EmployeeWithRelations> {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") notFound();
  return user;
}
