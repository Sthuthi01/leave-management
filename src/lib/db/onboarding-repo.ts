import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { loadSnapshot } from "./repo";
import * as schema from "./schema";
import { resourceVisibleToEmployee } from "@/lib/onboarding";
import type {
  AudienceScope,
  MyOnboardingChecklist,
  OnboardingChecklist,
  OnboardingChecklistDetail,
  OnboardingEmployeeProgress,
  OnboardingResource,
  OnboardingResourceAttachment,
  OnboardingResourceDocument,
  OnboardingResourceVersion,
  OnboardingTask,
  OnboardingTaskWithProgress,
  OnboardingTaskWithResource,
  ResourceCategory,
  ResourceStatus,
  Role,
} from "@/types";

type ResourceRow = typeof schema.onboardingResources.$inferSelect;
type DocumentRow = typeof schema.onboardingResourceDocuments.$inferSelect;

function rowToDocumentMeta(row: Pick<DocumentRow, "id" | "fileName" | "mimeType" | "fileSize" | "uploadedAt">): OnboardingResourceDocument {
  return { id: row.id, fileName: row.fileName, mimeType: row.mimeType, fileSize: row.fileSize, uploadedAt: row.uploadedAt.toISOString() };
}

function rowToResource(row: ResourceRow, attachments: OnboardingResourceAttachment[] = [], document: OnboardingResourceDocument | null = null): OnboardingResource {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    content: row.content,
    url: row.url,
    document,
    status: row.status,
    isRequired: row.isRequired,
    audienceScope: row.audienceScope,
    audienceDepartmentId: row.audienceDepartmentId,
    audienceRole: row.audienceRole,
    effectiveDate: row.effectiveDate,
    version: row.version,
    attachments,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToChecklist(row: typeof schema.onboardingChecklists.$inferSelect): OnboardingChecklist {
  return { id: row.id, name: row.name, description: row.description, isActive: row.isActive };
}

function rowToTask(row: typeof schema.onboardingTasks.$inferSelect): OnboardingTask {
  return { ...row };
}

async function attachmentsByResourceIds(resourceIds: string[]): Promise<Map<string, OnboardingResourceAttachment[]>> {
  if (resourceIds.length === 0) return new Map();
  const rows = await db.select().from(schema.onboardingResourceAttachments).where(inArray(schema.onboardingResourceAttachments.resourceId, resourceIds));
  const map = new Map<string, OnboardingResourceAttachment[]>();
  for (const r of rows) {
    const list = map.get(r.resourceId) ?? [];
    list.push({ id: r.id, name: r.name, url: r.url });
    map.set(r.resourceId, list);
  }
  return map;
}

async function insertAttachments(resourceId: string, attachments: { name: string; url: string }[]): Promise<OnboardingResourceAttachment[]> {
  if (attachments.length === 0) return [];
  const rows = attachments.map((a) => ({ id: randomUUID(), resourceId, name: a.name, url: a.url, createdAt: new Date() }));
  await db.insert(schema.onboardingResourceAttachments).values(rows);
  return rows.map((r) => ({ id: r.id, name: r.name, url: r.url }));
}

async function replaceAttachments(resourceId: string, attachments: { name: string; url: string }[]): Promise<OnboardingResourceAttachment[]> {
  await db.delete(schema.onboardingResourceAttachments).where(eq(schema.onboardingResourceAttachments.resourceId, resourceId));
  return insertAttachments(resourceId, attachments);
}

// Metadata columns only — the base64 file body is fetched separately (getResourceDocumentData)
// so list/detail payloads for resources stay small.
const documentMetaColumns = {
  id: schema.onboardingResourceDocuments.id,
  resourceId: schema.onboardingResourceDocuments.resourceId,
  fileName: schema.onboardingResourceDocuments.fileName,
  mimeType: schema.onboardingResourceDocuments.mimeType,
  fileSize: schema.onboardingResourceDocuments.fileSize,
  uploadedAt: schema.onboardingResourceDocuments.uploadedAt,
};

async function documentsByResourceIds(resourceIds: string[]): Promise<Map<string, OnboardingResourceDocument>> {
  if (resourceIds.length === 0) return new Map();
  const rows = await db.select(documentMetaColumns).from(schema.onboardingResourceDocuments).where(inArray(schema.onboardingResourceDocuments.resourceId, resourceIds));
  return new Map(rows.map((r) => [r.resourceId, rowToDocumentMeta(r)]));
}

// ---- resources ----

export async function listResources(forEmployee?: { departmentId: string; role: Role } | null): Promise<OnboardingResource[]> {
  const rows = await db.select().from(schema.onboardingResources).orderBy(asc(schema.onboardingResources.createdAt), asc(schema.onboardingResources.id));
  const ids = rows.map((r) => r.id);
  const [attachmentsMap, documentsMap] = await Promise.all([attachmentsByResourceIds(ids), documentsByResourceIds(ids)]);
  const resources = rows.map((r) => rowToResource(r, attachmentsMap.get(r.id) ?? [], documentsMap.get(r.id) ?? null));
  return forEmployee ? resources.filter((r) => resourceVisibleToEmployee(r, forEmployee)) : resources;
}

export async function getResource(id: string): Promise<OnboardingResource | undefined> {
  const [row] = await db.select().from(schema.onboardingResources).where(eq(schema.onboardingResources.id, id)).limit(1);
  if (!row) return undefined;
  const [attachmentsMap, documentsMap] = await Promise.all([attachmentsByResourceIds([id]), documentsByResourceIds([id])]);
  return rowToResource(row, attachmentsMap.get(id) ?? [], documentsMap.get(id) ?? null);
}

/** Full document row including the base64 file body — only for the download endpoint. */
export async function getResourceDocumentData(resourceId: string): Promise<DocumentRow | undefined> {
  const [row] = await db.select().from(schema.onboardingResourceDocuments).where(eq(schema.onboardingResourceDocuments.resourceId, resourceId)).limit(1);
  return row;
}

/** Replaces the resource's primary document wholesale — there's only ever one per resource. */
export async function setResourceDocument(
  resourceId: string,
  input: { fileName: string; mimeType: string; fileSize: number; dataBase64: string }
): Promise<OnboardingResourceDocument> {
  await db.delete(schema.onboardingResourceDocuments).where(eq(schema.onboardingResourceDocuments.resourceId, resourceId));
  const row = { id: randomUUID(), resourceId, ...input, uploadedAt: new Date() };
  await db.insert(schema.onboardingResourceDocuments).values(row);
  return rowToDocumentMeta(row);
}

export async function deleteResourceDocument(resourceId: string): Promise<void> {
  await db.delete(schema.onboardingResourceDocuments).where(eq(schema.onboardingResourceDocuments.resourceId, resourceId));
}

export async function insertResource(input: {
  title: string;
  category: ResourceCategory;
  description: string;
  content: string | null;
  url: string | null;
  status: ResourceStatus;
  isRequired: boolean;
  audienceScope: AudienceScope;
  audienceDepartmentId: string | null;
  audienceRole: Role | null;
  effectiveDate: string | null;
  attachments: { name: string; url: string }[];
}): Promise<OnboardingResource> {
  const id = randomUUID();
  const row: ResourceRow = {
    id,
    title: input.title,
    category: input.category,
    description: input.description,
    content: input.content,
    url: input.url,
    status: input.status,
    isRequired: input.isRequired,
    audienceScope: input.audienceScope,
    audienceDepartmentId: input.audienceDepartmentId,
    audienceRole: input.audienceRole,
    effectiveDate: input.effectiveDate,
    version: 1,
    createdAt: new Date(),
  };
  await db.insert(schema.onboardingResources).values(row);
  const attachments = await insertAttachments(id, input.attachments);
  return rowToResource(row, attachments);
}

const CONTENT_FIELDS = ["title", "category", "description", "content", "url"] as const;

/**
 * Applies a full patch (every field resolved to its final value by the caller). If any
 * content-facing field actually changed, the pre-edit content is archived as a version and the
 * version counter is bumped — metadata-only edits (status, audience, required, effective date)
 * don't create a new version.
 */
export async function updateResource(
  id: string,
  patch: {
    title: string;
    category: ResourceCategory;
    description: string;
    content: string | null;
    url: string | null;
    status: ResourceStatus;
    isRequired: boolean;
    audienceScope: AudienceScope;
    audienceDepartmentId: string | null;
    audienceRole: Role | null;
    effectiveDate: string | null;
    attachments?: { name: string; url: string }[];
  },
  editor: { id: string; name: string }
): Promise<void> {
  const [current] = await db.select().from(schema.onboardingResources).where(eq(schema.onboardingResources.id, id)).limit(1);
  if (!current) return;

  const contentChanged = CONTENT_FIELDS.some((f) => patch[f] !== current[f]);
  let version = current.version;
  if (contentChanged) {
    await db.insert(schema.onboardingResourceVersions).values({
      id: randomUUID(),
      resourceId: id,
      version: current.version,
      title: current.title,
      category: current.category,
      description: current.description,
      content: current.content,
      url: current.url,
      editedAt: new Date(),
      editedById: editor.id,
      editedByName: editor.name,
    });
    version = current.version + 1;
  }

  const { attachments, ...rest } = patch;
  await db.update(schema.onboardingResources).set({ ...rest, version }).where(eq(schema.onboardingResources.id, id));
  if (attachments !== undefined) await replaceAttachments(id, attachments);
}

export async function getResourceVersions(resourceId: string): Promise<OnboardingResourceVersion[]> {
  const rows = await db
    .select()
    .from(schema.onboardingResourceVersions)
    .where(eq(schema.onboardingResourceVersions.resourceId, resourceId))
    .orderBy(desc(schema.onboardingResourceVersions.version));
  return rows.map((r) => ({
    version: r.version,
    title: r.title,
    category: r.category,
    description: r.description,
    content: r.content,
    url: r.url,
    editedAt: r.editedAt.toISOString(),
    editedByName: r.editedByName,
  }));
}

export async function resourceInUseByTasks(id: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.onboardingTasks.id }).from(schema.onboardingTasks).where(eq(schema.onboardingTasks.resourceId, id)).limit(1);
  return !!row;
}

export async function deleteResource(id: string): Promise<void> {
  await db.delete(schema.onboardingResourceAttachments).where(eq(schema.onboardingResourceAttachments.resourceId, id));
  await db.delete(schema.onboardingResourceVersions).where(eq(schema.onboardingResourceVersions.resourceId, id));
  await db.delete(schema.onboardingResourceDocuments).where(eq(schema.onboardingResourceDocuments.resourceId, id));
  await db.delete(schema.onboardingResources).where(eq(schema.onboardingResources.id, id));
}

// ---- checklists ----

export async function checklistExists(id: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.onboardingChecklists.id }).from(schema.onboardingChecklists).where(eq(schema.onboardingChecklists.id, id)).limit(1);
  return !!row;
}

export async function listChecklists(): Promise<OnboardingChecklist[]> {
  const rows = await db.select().from(schema.onboardingChecklists).orderBy(asc(schema.onboardingChecklists.name));
  return rows.map(rowToChecklist);
}

async function tasksWithResources(checklistId: string): Promise<OnboardingTaskWithResource[]> {
  const taskRows = await db
    .select()
    .from(schema.onboardingTasks)
    .where(eq(schema.onboardingTasks.checklistId, checklistId))
    .orderBy(asc(schema.onboardingTasks.sortOrder));

  const resourceIds = [...new Set(taskRows.map((t) => t.resourceId).filter((x): x is string => !!x))];
  const resources = resourceIds.length ? await db.select().from(schema.onboardingResources).where(inArray(schema.onboardingResources.id, resourceIds)) : [];
  const [attachmentsMap, documentsMap] = await Promise.all([attachmentsByResourceIds(resourceIds), documentsByResourceIds(resourceIds)]);
  const resourceById = new Map(resources.map((r) => [r.id, rowToResource(r, attachmentsMap.get(r.id) ?? [], documentsMap.get(r.id) ?? null)]));

  return taskRows.map((t) => ({ ...rowToTask(t), resource: t.resourceId ? (resourceById.get(t.resourceId) ?? null) : null }));
}

export async function checklistAssignedCount(checklistId: string): Promise<number> {
  const rows = await db.select({ id: schema.employees.id }).from(schema.employees).where(eq(schema.employees.onboardingChecklistId, checklistId));
  return rows.length;
}

export async function getChecklistDetail(id: string): Promise<OnboardingChecklistDetail | undefined> {
  const [row] = await db.select().from(schema.onboardingChecklists).where(eq(schema.onboardingChecklists.id, id)).limit(1);
  if (!row) return undefined;
  const [tasks, assignedEmployeeCount] = await Promise.all([tasksWithResources(id), checklistAssignedCount(id)]);
  return { ...rowToChecklist(row), tasks, assignedEmployeeCount };
}

export async function insertChecklist(input: { name: string; description: string | null }): Promise<OnboardingChecklist> {
  const checklist = { id: randomUUID(), name: input.name, description: input.description, isActive: true };
  await db.insert(schema.onboardingChecklists).values(checklist);
  return rowToChecklist(checklist);
}

export async function updateChecklist(id: string, patch: Partial<{ name: string; description: string | null; isActive: boolean }>): Promise<void> {
  await db.update(schema.onboardingChecklists).set(patch).where(eq(schema.onboardingChecklists.id, id));
}

/** Deletes a checklist along with its tasks and any completion records for those tasks. */
export async function deleteChecklist(checklistId: string): Promise<void> {
  const taskRows = await db.select({ id: schema.onboardingTasks.id }).from(schema.onboardingTasks).where(eq(schema.onboardingTasks.checklistId, checklistId));
  const taskIds = taskRows.map((t) => t.id);
  if (taskIds.length > 0) {
    await db.delete(schema.employeeTaskCompletions).where(inArray(schema.employeeTaskCompletions.taskId, taskIds));
    await db.delete(schema.onboardingTasks).where(eq(schema.onboardingTasks.checklistId, checklistId));
  }
  await db.delete(schema.onboardingChecklists).where(eq(schema.onboardingChecklists.id, checklistId));
}

// ---- tasks ----

export async function getTask(taskId: string): Promise<OnboardingTask | undefined> {
  const [row] = await db.select().from(schema.onboardingTasks).where(eq(schema.onboardingTasks.id, taskId)).limit(1);
  return row ? rowToTask(row) : undefined;
}

export async function insertTask(input: { checklistId: string; title: string; description: string | null; resourceId: string | null }): Promise<OnboardingTask> {
  const siblings = await db
    .select({ sortOrder: schema.onboardingTasks.sortOrder })
    .from(schema.onboardingTasks)
    .where(eq(schema.onboardingTasks.checklistId, input.checklistId));
  const nextOrder = siblings.length > 0 ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0;
  const task: OnboardingTask = { id: randomUUID(), sortOrder: nextOrder, ...input };
  await db.insert(schema.onboardingTasks).values(task);
  return task;
}

export async function updateTask(id: string, patch: Partial<{ title: string; description: string | null; resourceId: string | null }>): Promise<void> {
  await db.update(schema.onboardingTasks).set(patch).where(eq(schema.onboardingTasks.id, id));
}

/** Deletes a task along with any completion records for it. */
export async function deleteTask(taskId: string): Promise<void> {
  await db.delete(schema.employeeTaskCompletions).where(eq(schema.employeeTaskCompletions.taskId, taskId));
  await db.delete(schema.onboardingTasks).where(eq(schema.onboardingTasks.id, taskId));
}

export async function moveTask(taskId: string, direction: "up" | "down"): Promise<void> {
  const task = await getTask(taskId);
  if (!task) return;
  const siblings = await db
    .select()
    .from(schema.onboardingTasks)
    .where(eq(schema.onboardingTasks.checklistId, task.checklistId))
    .orderBy(asc(schema.onboardingTasks.sortOrder));
  const idx = siblings.findIndex((s) => s.id === taskId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;

  const a = siblings[idx];
  const b = siblings[swapIdx];
  await db.update(schema.onboardingTasks).set({ sortOrder: b.sortOrder }).where(eq(schema.onboardingTasks.id, a.id));
  await db.update(schema.onboardingTasks).set({ sortOrder: a.sortOrder }).where(eq(schema.onboardingTasks.id, b.id));
}

// ---- employee-facing progress ----

export async function getMyChecklist(employeeId: string, checklistId: string): Promise<MyOnboardingChecklist | undefined> {
  const [row] = await db.select().from(schema.onboardingChecklists).where(eq(schema.onboardingChecklists.id, checklistId)).limit(1);
  if (!row) return undefined;

  const [tasks, completions] = await Promise.all([
    tasksWithResources(checklistId),
    db.select().from(schema.employeeTaskCompletions).where(eq(schema.employeeTaskCompletions.employeeId, employeeId)),
  ]);
  const completedAtByTask = new Map(completions.map((c) => [c.taskId, c.completedAt]));

  const tasksWithProgress: OnboardingTaskWithProgress[] = tasks.map((t) => ({
    ...t,
    completed: completedAtByTask.has(t.id),
    completedAt: completedAtByTask.get(t.id)?.toISOString() ?? null,
  }));

  return { checklist: rowToChecklist(row), tasks: tasksWithProgress };
}

export async function setTaskCompletion(employeeId: string, taskId: string, completed: boolean): Promise<void> {
  if (completed) {
    await db
      .insert(schema.employeeTaskCompletions)
      .values({ employeeId, taskId, completedAt: new Date() })
      .onConflictDoNothing({ target: [schema.employeeTaskCompletions.employeeId, schema.employeeTaskCompletions.taskId] });
  } else {
    await db
      .delete(schema.employeeTaskCompletions)
      .where(and(eq(schema.employeeTaskCompletions.employeeId, employeeId), eq(schema.employeeTaskCompletions.taskId, taskId)));
  }
}

// ---- HR-facing progress ----

export async function listEmployeeOnboardingProgress(): Promise<OnboardingEmployeeProgress[]> {
  const [snapshot, checklistRows, taskRows, completionRows] = await Promise.all([
    loadSnapshot(),
    db.select().from(schema.onboardingChecklists),
    db.select().from(schema.onboardingTasks),
    db.select().from(schema.employeeTaskCompletions),
  ]);

  const checklistById = new Map(checklistRows.map((c) => [c.id, rowToChecklist(c)]));
  const taskCountByChecklist = new Map<string, number>();
  const checklistByTaskId = new Map<string, string>();
  for (const t of taskRows) {
    taskCountByChecklist.set(t.checklistId, (taskCountByChecklist.get(t.checklistId) ?? 0) + 1);
    checklistByTaskId.set(t.id, t.checklistId);
  }

  const completionsByEmployee = new Map<string, { taskId: string; completedAt: Date }[]>();
  for (const c of completionRows) {
    const list = completionsByEmployee.get(c.employeeId) ?? [];
    list.push({ taskId: c.taskId, completedAt: c.completedAt });
    completionsByEmployee.set(c.employeeId, list);
  }

  return snapshot.employees
    .filter((e) => e.status === "ACTIVE")
    .map((e): OnboardingEmployeeProgress => {
      const department = snapshot.departments.find((d) => d.id === e.departmentId)!;
      const checklist = e.onboardingChecklistId ? (checklistById.get(e.onboardingChecklistId) ?? null) : null;
      const totalTasks = e.onboardingChecklistId ? (taskCountByChecklist.get(e.onboardingChecklistId) ?? 0) : 0;
      const relevantCompletions = (completionsByEmployee.get(e.id) ?? []).filter((c) => checklistByTaskId.get(c.taskId) === e.onboardingChecklistId);
      const lastActivityAt = relevantCompletions.length
        ? new Date(Math.max(...relevantCompletions.map((c) => c.completedAt.getTime()))).toISOString()
        : null;
      return {
        employee: { id: e.id, name: e.name, email: e.email, avatarUrl: e.avatarUrl ?? null, status: e.status },
        department,
        checklist,
        completedTasks: relevantCompletions.length,
        totalTasks,
        lastActivityAt,
      };
    })
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
}
