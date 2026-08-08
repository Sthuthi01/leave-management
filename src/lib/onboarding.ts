import type { OnboardingResource, ResourceEffectiveState, Role } from "@/types";

/** Whether a resource's audience targeting matches this employee. */
export function resourceAudienceMatches(resource: OnboardingResource, employee: { departmentId: string; role: Role }): boolean {
  switch (resource.audienceScope) {
    case "ALL":
      return true;
    case "DEPARTMENT":
      return resource.audienceDepartmentId === employee.departmentId;
    case "ROLE":
      return resource.audienceRole === employee.role;
  }
}

/** A resource's real-world visibility, folding its Draft/Published status together with its effective date. */
export function resourceEffectiveState(resource: Pick<OnboardingResource, "status" | "effectiveDate">, today: string = todayISODate()): ResourceEffectiveState {
  if (resource.status === "DRAFT") return "DRAFT";
  if (resource.effectiveDate && resource.effectiveDate > today) return "SCHEDULED";
  return "LIVE";
}

/** Whether an employee should actually see this resource in their library / required list right now. */
export function resourceVisibleToEmployee(resource: OnboardingResource, employee: { departmentId: string; role: Role }): boolean {
  return resourceEffectiveState(resource) === "LIVE" && resourceAudienceMatches(resource, employee);
}

export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}
