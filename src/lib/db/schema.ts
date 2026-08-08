import { boolean, date, integer, pgEnum, pgTable, primaryKey, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["EMPLOYEE", "MANAGER", "ADMIN"]);
export const employeeStatusEnum = pgEnum("employee_status", ["ACTIVE", "INACTIVE"]);
export const accrualMethodEnum = pgEnum("accrual_method", ["ANNUAL", "MONTHLY"]);
export const leaveStatusEnum = pgEnum("leave_status", ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
export const resourceCategoryEnum = pgEnum("resource_category", ["GUIDE", "POLICY", "TRAINING"]);
export const resourceStatusEnum = pgEnum("resource_status", ["DRAFT", "PUBLISHED"]);
export const resourceAudienceScopeEnum = pgEnum("resource_audience_scope", ["ALL", "DEPARTMENT", "ROLE"]);
// INVITE = first-time account setup after HR creates an employee; RESET = self-service forgot-password.
// Both share one table since they're the same primitive: a single-use, time-limited token that lets
// someone who isn't signed in yet prove control of an email address and then set a password.
export const tokenPurposeEnum = pgEnum("token_purpose", ["INVITE", "RESET"]);

export const departments = pgTable("departments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const employees = pgTable("employees", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  avatarUrl: text("avatar_url"),
  role: roleEnum("role").notNull(),
  title: text("title").notNull(),
  departmentId: text("department_id")
    .notNull()
    .references(() => departments.id),
  managerId: text("manager_id"),
  joinedAt: date("joined_at", { mode: "string" }).notNull(),
  status: employeeStatusEnum("status").notNull(),
  onboardingChecklistId: text("onboarding_checklist_id").references((): AnyPgColumn => onboardingChecklists.id),
  // Null until the employee activates their account via an invitation (or resets a forgotten
  // password). Never selected as part of the app's normal employee queries — see loadSnapshot()
  // in repo.ts, which explicitly excludes it, and invitation-repo.ts, which is the only place
  // that reads it, for authentication purposes only.
  passwordHash: text("password_hash"),
  // Bumped every time passwordHash changes (see setEmployeePassword in invitation-repo.ts). A
  // session cookie embeds the version it was issued under, so a cookie issued before a password
  // change — e.g. one an attacker copied — stops verifying the moment the real owner changes
  // their password, instead of staying valid indefinitely. Like passwordHash, never selected as
  // part of the app's normal employee queries — only invitation-repo.ts's auth-only reads use it.
  sessionVersion: integer("session_version").notNull().default(0),
});

export const leaveTypes = pgTable("leave_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  color: text("color").notNull(),
  defaultDaysPerYear: integer("default_days_per_year").notNull(),
  requiresApproval: boolean("requires_approval").notNull(),
  isActive: boolean("is_active").notNull(),
  accrualMethod: accrualMethodEnum("accrual_method").notNull(),
  carryForwardLimit: integer("carry_forward_limit").notNull(),
});

export const holidays = pgTable("holidays", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  optional: boolean("optional").notNull(),
});

export const leaveBalances = pgTable(
  "leave_balances",
  {
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    leaveTypeId: text("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    year: integer("year").notNull(),
    allocated: integer("allocated").notNull(),
    used: integer("used").notNull(),
    carriedForward: integer("carried_forward").notNull(),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.leaveTypeId, t.year] })]
);

export const leaveRequests = pgTable("leave_requests", {
  id: text("id").primaryKey(),
  referenceNumber: text("reference_number").notNull().unique(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id),
  leaveTypeId: text("leave_type_id")
    .notNull()
    .references(() => leaveTypes.id),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  days: integer("days").notNull(),
  reason: text("reason").notNull(),
  status: leaveStatusEnum("status").notNull(),
  approverId: text("approver_id"),
  approverComment: text("approver_comment"),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true, mode: "date" }).notNull(),
  actorId: text("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetLabel: text("target_label").notNull(),
  details: text("details"),
});

// Single-row table (id is always 1) holding organization-wide settings.
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  workingDays: integer("working_days").array().notNull(),
  upcomingLeaveWindowDays: integer("upcoming_leave_window_days").notNull(),
  pendingApprovalUrgencyDays: integer("pending_approval_urgency_days").notNull(),
  auditLogDisplayLimit: integer("audit_log_display_limit").notNull(),
  sessionMaxAgeDays: integer("session_max_age_days").notNull(),
});

// ---- Onboarding ----

// A shared content library — guides, policies, and training materials all read the same way,
// so one table with a category keeps this maintainable instead of three near-identical ones.
export const onboardingResources = pgTable("onboarding_resources", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  category: resourceCategoryEnum("category").notNull(),
  description: text("description").notNull(),
  // Rich-text body. Optional — a resource's primary content may instead be an uploaded document
  // (see onboardingResourceDocuments) or an external link.
  content: text("content"),
  url: text("url"),
  status: resourceStatusEnum("status").notNull().default("DRAFT"),
  isRequired: boolean("is_required").notNull().default(false),
  // Who this resource applies to: everyone, one department, or one role. Only the matching
  // audienceDepartmentId/audienceRole column is read, based on audienceScope.
  audienceScope: resourceAudienceScopeEnum("audience_scope").notNull().default("ALL"),
  audienceDepartmentId: text("audience_department_id").references(() => departments.id),
  audienceRole: roleEnum("audience_role"),
  // When the resource becomes visible to its audience; null means immediately.
  effectiveDate: date("effective_date", { mode: "string" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

// The primary uploaded document for a resource (e.g. a policy PDF) — one per resource, replaced
// wholesale on re-upload. File bytes are kept as base64 text; there's no object storage in this
// stack, and these are small enough (size-limited at upload time) for Postgres to hold directly.
export const onboardingResourceDocuments = pgTable("onboarding_resource_documents", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id")
    .notNull()
    .references(() => onboardingResources.id),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  dataBase64: text("data_base64").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const onboardingResourceAttachments = pgTable("onboarding_resource_attachments", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id")
    .notNull()
    .references(() => onboardingResources.id),
  name: text("name").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

// A snapshot of a resource's content taken every time it's meaningfully edited, so admins can see
// what changed and when — the resource row itself always holds the current version.
export const onboardingResourceVersions = pgTable("onboarding_resource_versions", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id")
    .notNull()
    .references(() => onboardingResources.id),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  category: resourceCategoryEnum("category").notNull(),
  description: text("description").notNull(),
  content: text("content"),
  url: text("url"),
  editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }).notNull(),
  editedById: text("edited_by_id").notNull(),
  editedByName: text("edited_by_name").notNull(),
});

export const onboardingChecklists = pgTable("onboarding_checklists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull(),
});

export const onboardingTasks = pgTable("onboarding_tasks", {
  id: text("id").primaryKey(),
  checklistId: text("checklist_id")
    .notNull()
    .references(() => onboardingChecklists.id),
  title: text("title").notNull(),
  description: text("description"),
  resourceId: text("resource_id").references(() => onboardingResources.id),
  sortOrder: integer("sort_order").notNull(),
});

// A row's presence means the task is complete — no boolean to keep in sync, just insert/delete.
export const employeeTaskCompletions = pgTable(
  "employee_task_completions",
  {
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    taskId: text("task_id")
      .notNull()
      .references(() => onboardingTasks.id),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.taskId] })]
);

// ---- Auth: invitations & password resets ----

// Stores a hash of the token, never the raw value — the raw token only ever exists in the emailed
// link and briefly in memory while handling that request, so a database leak can't be used to log
// in as anyone. Old unused tokens for the same employee+purpose are invalidated (usedAt set) when a
// new one is issued, so "Resend Invitation" can't leave multiple valid links floating around.
export const passwordSetupTokens = pgTable("password_setup_tokens", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: tokenPurposeEnum("purpose").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});
