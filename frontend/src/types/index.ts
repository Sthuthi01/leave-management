export type Role = "EMPLOYEE" | "MANAGER" | "ADMIN";
export type EmployeeStatus = "ACTIVE" | "INACTIVE";

export interface Department {
  id: number;
  name: string;
}

export interface Employee {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  role: Role;
  title: string;
  department: Department;
  manager: number | null;
  manager_name: string | null;
  joined_at: string;
  status: EmployeeStatus;
  has_password: boolean;
  onboarding_checklist: number | null;
  onboarding_checklist_name: string | null;
}

export type AccrualMethod = "ANNUAL" | "MONTHLY";

export interface LeaveType {
  id: number;
  name: string;
  code: string;
  color: string;
  default_days_per_year: number;
  requires_approval: boolean;
  is_active: boolean;
  accrual_method: AccrualMethod;
  carry_forward_limit: number;
  created_at: string;
  updated_at: string;
}

export interface Holiday {
  id: number;
  name: string;
  date: string;
  optional: boolean;
  created_at: string;
  updated_at: string;
}

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface LeaveRequestEmployee {
  id: number;
  name: string;
  email: string;
  department: Department;
}

export interface LeaveRequest {
  id: number;
  reference_number: string;
  employee: LeaveRequestEmployee;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  approver: number | null;
  approver_comment: string | null;
  applied_at: string;
  decided_at: string | null;
}

export interface LeaveBalance {
  id: number;
  leave_type: LeaveType;
  year: number;
  allocated: number;
  used: number;
  carried_forward: number;
  accrued_to_date: number;
  remaining: number;
}

export interface LeavePreview {
  days: number;
  is_capped: boolean;
  remaining_balance: number | null;
  balance_after: number | null;
  insufficient_balance: boolean;
}

export interface EmployeeDashboardData {
  kind: "EMPLOYEE";
  balances: LeaveBalance[];
  recent_requests: LeaveRequest[];
  upcoming_leave: LeaveRequest[];
  upcoming_holidays: Holiday[];
  pending_approvals_count: number;
}

export interface HrRefEmployee {
  id: number;
  name: string;
}

export interface HrRefLeaveType {
  id: number;
  name: string;
  color: string;
  code: string;
}

export interface HrLeaveRequest {
  id: number;
  reference_number: string;
  employee: HrRefEmployee;
  leave_type: HrRefLeaveType;
  start_date: string;
  end_date: string;
  days: number;
  status: LeaveStatus;
  approver: HrRefEmployee | null;
  applied_at: string;
}

export interface LeaveTypeUtilization {
  leave_type: HrRefLeaveType;
  allocated: number;
  used: number;
}

export interface DepartmentStat {
  department: Department;
  employee_count: number;
  on_leave_today: number;
}

export interface AttentionPendingApproval {
  request: HrLeaveRequest;
  days_pending: number;
  days_until_start: number;
}

export interface EmployeeWithoutManager {
  id: number;
  name: string;
  title: string;
}

export interface HrDashboardData {
  kind: "HR";
  on_leave_today: HrLeaveRequest[];
  on_leave_this_week: number;
  leave_utilization: LeaveTypeUtilization[];
  department_stats: DepartmentStat[];
  attention_pending_approvals: AttentionPendingApproval[];
  employees_without_manager: EmployeeWithoutManager[];
  total_employees: number;
  pending_approvals_count: number;
  recent_requests: HrLeaveRequest[];
  upcoming_holidays: Holiday[];
}

export type DashboardData = EmployeeDashboardData | HrDashboardData;

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  actor_name: string;
  action: string;
  target_type: string;
  target_label: string;
  details: string | null;
}

export interface OrganizationSettings {
  working_days: number[];
  pending_approval_urgency_days: number;
  audit_log_display_limit: number;
  session_max_age_days: number;
}

export type TeamCalendarScope = "team" | "company";

export interface TeamCalendarEntry {
  employee: { id: number; name: string; avatar_url: string | null };
  leave_type: HrRefLeaveType;
  start_date: string;
  end_date: string;
}

export interface TeamCalendarData {
  month: string;
  scope: TeamCalendarScope;
  department_name: string | null;
  entries: TeamCalendarEntry[];
  holidays: Holiday[];
}

export interface ReportEmployee {
  id: number;
  name: string;
  department: Department;
}

export interface ReportLeaveRequest {
  id: number;
  reference_number: string;
  employee: ReportEmployee;
  leave_type: HrRefLeaveType;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  approver: HrRefEmployee | null;
  approver_comment: string | null;
  applied_at: string;
  decided_at: string | null;
}

export interface ReportsData {
  filters: {
    from: string;
    to: string;
    department_id: number | null;
    leave_type_id: number | null;
  };
  departments: Department[];
  leave_types: HrRefLeaveType[];
  requests: ReportLeaveRequest[];
  previous_requests: ReportLeaveRequest[];
}

// ---- Onboarding (Phase 6) ----

export type ResourceCategory = "GUIDE" | "POLICY" | "TRAINING";
export type ResourceStatus = "DRAFT" | "PUBLISHED";
export type AudienceScope = "ALL" | "DEPARTMENT" | "ROLE";
// Mirrors the source app's resourceEffectiveState() — derived client-side from status +
// effective_date, not a field the API returns (see lib/onboarding.ts).
export type ResourceEffectiveState = "DRAFT" | "SCHEDULED" | "LIVE";

export interface ResourceAttachment {
  id: number;
  name: string;
  url: string;
}

export interface ResourceDocument {
  id: number;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
}

export interface OnboardingResource {
  id: number;
  title: string;
  category: ResourceCategory;
  description: string;
  content: string | null;
  url: string | null;
  document: ResourceDocument | null;
  status: ResourceStatus;
  is_required: boolean;
  audience_scope: AudienceScope;
  audience_department: number | null;
  audience_role: Role | null;
  effective_date: string | null;
  version: number;
  attachments: ResourceAttachment[];
  created_at: string;
}

export interface ResourceVersion {
  version: number;
  title: string;
  category: ResourceCategory;
  description: string;
  content: string | null;
  url: string | null;
  edited_at: string;
  edited_by_name: string;
}

export interface OnboardingChecklist {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface OnboardingTask {
  id: number;
  checklist: number;
  title: string;
  description: string | null;
  resource: OnboardingResource | null;
  sort_order: number;
}

export interface OnboardingChecklistDetail extends OnboardingChecklist {
  tasks: OnboardingTask[];
  assigned_employee_count: number;
}

export interface OnboardingTaskWithCompletion {
  id: number;
  title: string;
  description: string | null;
  resource: OnboardingResource | null;
  sort_order: number;
  completed: boolean;
  completed_at: string | null;
}

export interface MyOnboardingChecklist {
  checklist: OnboardingChecklist;
  tasks: OnboardingTaskWithCompletion[];
}

export interface OnboardingEmployeeProgress {
  employee: { id: number; name: string; email: string; avatar_url: string | null; status: EmployeeStatus };
  department: Department;
  checklist: OnboardingChecklist | null;
  completed_tasks: number;
  total_tasks: number;
  last_activity_at: string | null;
}
