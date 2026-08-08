import { sql } from "drizzle-orm";
import { db } from "./client";
import * as schema from "./schema";
import * as mock from "@/lib/mock-data/seed";

/** Inserts the baseline demo dataset, but only if the database is empty — safe to call on every startup. */
export async function seedIfEmpty(): Promise<void> {
  const [existing] = await db.select({ id: schema.departments.id }).from(schema.departments).limit(1);
  if (existing) return;

  await db.insert(schema.departments).values(mock.departments);

  // Onboarding content is seeded before employees, since some employees reference a checklist.
  await db.insert(schema.onboardingResources).values(
    mock.onboardingResources.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      description: r.description,
      content: r.content,
      url: r.url,
      status: r.status,
      isRequired: r.isRequired,
      audienceScope: r.audienceScope,
      audienceDepartmentId: r.audienceDepartmentId,
      audienceRole: r.audienceRole,
      effectiveDate: r.effectiveDate,
      version: r.version,
      createdAt: new Date(r.createdAt),
    }))
  );
  const attachmentRows = mock.onboardingResources.flatMap((r) =>
    r.attachments.map((a) => ({ id: a.id, resourceId: r.id, name: a.name, url: a.url, createdAt: new Date(r.createdAt) }))
  );
  if (attachmentRows.length > 0) await db.insert(schema.onboardingResourceAttachments).values(attachmentRows);
  await db.insert(schema.onboardingChecklists).values(mock.onboardingChecklists);
  await db.insert(schema.onboardingTasks).values(mock.onboardingTasks);

  await db.insert(schema.employees).values(mock.employees);
  await db.insert(schema.leaveTypes).values(mock.leaveTypes);
  await db.insert(schema.holidays).values(mock.holidays);
  await db.insert(schema.leaveBalances).values(mock.leaveBalances);
  await db.insert(schema.leaveRequests).values(
    mock.leaveRequests.map((r) => ({
      ...r,
      appliedAt: new Date(r.appliedAt),
      decidedAt: r.decidedAt ? new Date(r.decidedAt) : null,
    }))
  );
  await db.insert(schema.employeeTaskCompletions).values(mock.onboardingTaskCompletions.map((c) => ({ ...c, completedAt: new Date(c.completedAt) })));
  await db.insert(schema.appSettings).values({ id: 1, ...mock.defaultSettings });

  // So the next call to nextRequestId() continues after the seeded reference numbers instead of colliding with them.
  await db.execute(sql`select setval('leave_request_seq', ${mock.leaveRequests.length})`);
}
