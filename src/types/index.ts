export type Role = "EMPLOYEE" | "MANAGER" | "ADMIN";

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export type EmployeeStatus = "ACTIVE" | "INACTIVE";

export type AccrualMethod = "ANNUAL" | "MONTHLY";

export interface Department {
  id: string;
  name: string;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  role: Role;
  title: string;
  departmentId: string;
  managerId: string | null;
  joinedAt: string;
  status: EmployeeStatus;
  onboardingChecklistId: string | null;
}

/**
 * An employee record as read back from the database, with `hasPassword` folded in — whether this
 * account has ever had a password set, never the password/hash itself. Combined with `status` to
 * show HR the account's real-world state: INACTIVE -> "Inactive", else !hasPassword -> "Invitation
 * Pending", else "Active". Kept separate from `Employee` (the create/update payload shape, which has
 * no business setting this) rather than folding it into that type.
 */
export interface EmployeeRecord extends Employee {
  hasPassword: boolean;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  color: string;
  defaultDaysPerYear: number;
  requiresApproval: boolean;
  isActive: boolean;
  /** ANNUAL = full allocation available immediately; MONTHLY = accrues proportionally through the year. */
  accrualMethod: AccrualMethod;
  /** Max unused days that roll over into the next year's allocation. */
  carryForwardLimit: number;
}

export interface LeaveBalance {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  allocated: number;
  used: number;
  /** Days rolled over from the previous year, already folded into `allocated` — kept separately for display. */
  carriedForward: number;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  optional: boolean;
}

export interface LeaveRequest {
  id: string;
  referenceNumber: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  approverId: string | null;
  approverComment: string | null;
  appliedAt: string;
  decidedAt: string | null;
}

// ---- Hydrated (joined) shapes returned by the API ----

export interface EmployeeWithRelations extends EmployeeRecord {
  department: Department;
  manager: Pick<Employee, "id" | "name" | "email"> | null;
  /** Count of employees who report directly to this person — determines manager-only UI like My Approvals. */
  directReportsCount: number;
}

export interface LeaveRequestWithRelations extends LeaveRequest {
  employee: Pick<Employee, "id" | "name" | "email" | "avatarUrl" | "departmentId">;
  leaveType: LeaveType;
  approver: Pick<Employee, "id" | "name" | "email"> | null;
}

export interface LeaveBalanceSummary {
  leaveType: LeaveType;
  year: number;
  allocated: number;
  used: number;
  remaining: number;
  /** How much of `allocated` is actually usable today — equals `allocated` unless the leave type accrues monthly. */
  accruedToDate: number;
  carriedForward: number;
}

export interface EmployeeDashboardData {
  kind: "EMPLOYEE";
  balances: LeaveBalanceSummary[];
  recentRequests: LeaveRequestWithRelations[];
  upcomingLeave: LeaveRequestWithRelations[];
  upcomingHolidays: Holiday[];
  pendingApprovalsCount: number;
}

export interface DepartmentStat {
  department: Department;
  employeeCount: number;
  onLeaveToday: number;
}

export interface LeaveTypeUtilization {
  leaveType: LeaveType;
  allocated: number;
  used: number;
}

export interface AttentionPendingApproval {
  request: LeaveRequestWithRelations;
  /** Whole days since the request was submitted. */
  daysPending: number;
  /** Days until the leave starts — zero or negative means it starts today or has already begun. */
  daysUntilStart: number;
}

export interface HrDashboardData {
  kind: "HR";
  totalEmployees: number;
  onLeaveToday: LeaveRequestWithRelations[];
  /** Count of approved leave overlapping the next 7 days (today included). */
  onLeaveThisWeek: number;
  pendingApprovalsCount: number;
  /** Pending requests that are either overdue (past the urgency threshold) or start imminently. */
  attentionPendingApprovals: AttentionPendingApproval[];
  /** Active, non-admin employees with no manager on file — leave requests that need approval will fail for them. */
  employeesWithoutManager: Pick<Employee, "id" | "name" | "title">[];
  leaveUtilization: LeaveTypeUtilization[];
  departmentStats: DepartmentStat[];
  upcomingHolidays: Holiday[];
  recentRequests: LeaveRequestWithRelations[];
}

export type DashboardData = EmployeeDashboardData | HrDashboardData;

// ---- Audit log ----

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetLabel: string;
  details?: string | null;
}

// ---- Team calendar ----

export interface TeamCalendarEntry {
  employee: Pick<Employee, "id" | "name" | "avatarUrl">;
  leaveType: Pick<LeaveType, "id" | "name" | "color" | "code">;
  startDate: string;
  endDate: string;
}

export interface TeamCalendarData {
  month: string;
  entries: TeamCalendarEntry[];
  holidays: Holiday[];
  scope: "team" | "company";
  departmentName: string | null;
}

// ---- Reports ----

export interface DepartmentLeaveStat {
  department: Department;
  daysTaken: number;
  requestCount: number;
}

export interface ReportsFilters {
  from: string;
  to: string;
  departmentId: string | null;
  leaveTypeId: string | null;
}

export interface ReportsData {
  filters: ReportsFilters;
  departments: Department[];
  leaveTypes: LeaveType[];
  /** Requests whose leave dates overlap the selected period, matching the department/leave-type filters. */
  requests: LeaveRequestWithRelations[];
  /** Requests in an equal-length window immediately before the period — used for trend comparisons. */
  previousRequests: LeaveRequestWithRelations[];
}

// ---- Settings (organization-wide master data) ----

export interface AppSettings {
  /** Days of the week counted as working days: 0 = Sunday ... 6 = Saturday. */
  workingDays: number[];
  /** How many days ahead "upcoming leave" reports look. */
  upcomingLeaveWindowDays: number;
  /** A pending approval is flagged urgent once it's been waiting this many days. */
  pendingApprovalUrgencyDays: number;
  /** How many recent audit log entries are kept visible. */
  auditLogDisplayLimit: number;
  /** How long a signed-in session stays valid, in days. */
  sessionMaxAgeDays: number;
}

// ---- Onboarding ----

export type ResourceCategory = "GUIDE" | "POLICY" | "TRAINING";

export type ResourceStatus = "DRAFT" | "PUBLISHED";

/** Who a resource applies to: everyone, one department, or one role. */
export type AudienceScope = "ALL" | "DEPARTMENT" | "ROLE";

/** A resource's actual visibility right now, folding status + effective date together. */
export type ResourceEffectiveState = "DRAFT" | "SCHEDULED" | "LIVE";

export interface OnboardingResourceAttachment {
  id: string;
  name: string;
  url: string;
}

/** The primary uploaded document for a resource (e.g. a policy PDF). Metadata only — the file
 *  bytes are fetched separately via the download endpoint, not embedded in resource payloads. */
export interface OnboardingResourceDocument {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
}

export interface OnboardingResourceVersion {
  version: number;
  title: string;
  category: ResourceCategory;
  description: string;
  content: string | null;
  url: string | null;
  editedAt: string;
  editedByName: string;
}

export interface OnboardingResource {
  id: string;
  title: string;
  category: ResourceCategory;
  description: string;
  /** Rich-text body — optional; a resource's primary content may instead be `document` or `url`. */
  content: string | null;
  url: string | null;
  document: OnboardingResourceDocument | null;
  status: ResourceStatus;
  isRequired: boolean;
  audienceScope: AudienceScope;
  audienceDepartmentId: string | null;
  audienceRole: Role | null;
  effectiveDate: string | null;
  version: number;
  attachments: OnboardingResourceAttachment[];
  createdAt: string;
}

export interface OnboardingChecklist {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

/** A single employee's onboarding progress, as seen by HR. */
export interface OnboardingEmployeeProgress {
  employee: Pick<Employee, "id" | "name" | "email" | "avatarUrl" | "status">;
  department: Department;
  checklist: OnboardingChecklist | null;
  completedTasks: number;
  totalTasks: number;
  lastActivityAt: string | null;
}

export interface OnboardingTask {
  id: string;
  checklistId: string;
  title: string;
  description: string | null;
  resourceId: string | null;
  sortOrder: number;
}

/** A task as seen by the assigned employee — merged with their own completion state. */
export interface OnboardingTaskWithProgress extends OnboardingTask {
  resource: OnboardingResource | null;
  completed: boolean;
  completedAt: string | null;
}

/** A task as seen by an admin managing a checklist — no per-employee completion involved. */
export interface OnboardingTaskWithResource extends OnboardingTask {
  resource: OnboardingResource | null;
}

export interface OnboardingChecklistDetail extends OnboardingChecklist {
  tasks: OnboardingTaskWithResource[];
  assignedEmployeeCount: number;
}

export interface MyOnboardingChecklist {
  checklist: OnboardingChecklist;
  tasks: OnboardingTaskWithProgress[];
}
