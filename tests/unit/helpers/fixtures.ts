import { NextRequest } from "next/server";
import type { Department, EmployeeWithRelations } from "@/types";

export function makeDepartment(overrides: Partial<Department> = {}): Department {
  return { id: "dept-eng", name: "Engineering", ...overrides };
}

export function makeUser(overrides: Partial<EmployeeWithRelations> = {}): EmployeeWithRelations {
  return {
    id: "emp-1",
    name: "Test User",
    email: "test.user@example.com",
    avatarUrl: null,
    role: "EMPLOYEE",
    title: "Engineer",
    departmentId: "dept-eng",
    managerId: null,
    joinedAt: "2025-01-01",
    status: "ACTIVE",
    onboardingChecklistId: null,
    hasPassword: true,
    department: makeDepartment(),
    manager: null,
    directReportsCount: 0,
    ...overrides,
  };
}

export function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}
