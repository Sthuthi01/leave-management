import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeRequest, makeUser } from "./helpers/fixtures";
import type { LeaveRequest } from "@/types";

const { getCurrentUserFromRequest } = vi.hoisted(() => ({ getCurrentUserFromRequest: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserFromRequest }));

const repoMocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  decideLeaveRequest: vi.fn(),
  cancelLeaveRequest: vi.fn(),
  getOrCreateBalance: vi.fn(),
  setBalanceUsed: vi.fn(),
  logAudit: vi.fn(),
  hydrateLeaveRequest: vi.fn((_snapshot: unknown, request: unknown) => request),
}));
vi.mock("@/lib/db/repo", () => repoMocks);

function makeLeaveRequest(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: "leave-1",
    referenceNumber: "LR-0001",
    employeeId: "emp-2",
    leaveTypeId: "lt-casual",
    startDate: "2026-09-01",
    endDate: "2026-09-02",
    days: 2,
    reason: "Personal",
    status: "PENDING",
    approverId: "emp-manager",
    approverComment: null,
    appliedAt: "2026-08-01T00:00:00.000Z",
    decidedAt: null,
    ...overrides,
  };
}

describe("POST /api/leave-requests/[id]/decide — ownership-based authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  const params = Promise.resolve({ id: "leave-1" });

  it("rejects a manager who is not the assigned approver, even though they are a MANAGER", async () => {
    const someOtherManager = makeUser({ id: "emp-other-manager", role: "MANAGER" });
    getCurrentUserFromRequest.mockResolvedValue(someOtherManager);
    repoMocks.loadSnapshot.mockResolvedValue({
      leaveRequests: [makeLeaveRequest({ approverId: "emp-manager" })],
      employees: [makeUser({ id: "emp-2" })],
      leaveTypes: [],
    });

    const { POST } = await import("@/app/api/leave-requests/[id]/decide/route");
    const res = await POST(
      makeRequest("http://test/api/leave-requests/leave-1/decide", { method: "POST", body: JSON.stringify({ decision: "APPROVED" }) }),
      { params }
    );

    expect(res.status).toBe(403);
    expect(repoMocks.decideLeaveRequest).not.toHaveBeenCalled();
  });

  it("rejects an EMPLOYEE trying to decide a request outright, regardless of approverId", async () => {
    const employee = makeUser({ id: "emp-2", role: "EMPLOYEE" });
    getCurrentUserFromRequest.mockResolvedValue(employee);
    // Even in the contrived case where approverId somehow pointed at an employee, "not the
    // approver" is not what should gate this — but here it plainly isn't emp-2 either.
    repoMocks.loadSnapshot.mockResolvedValue({
      leaveRequests: [makeLeaveRequest({ approverId: "emp-manager" })],
      employees: [employee],
      leaveTypes: [],
    });

    const { POST } = await import("@/app/api/leave-requests/[id]/decide/route");
    const res = await POST(
      makeRequest("http://test/api/leave-requests/leave-1/decide", { method: "POST", body: JSON.stringify({ decision: "APPROVED" }) }),
      { params }
    );

    expect(res.status).toBe(403);
    expect(repoMocks.decideLeaveRequest).not.toHaveBeenCalled();
  });

  it("allows the assigned approver (manager) to approve", async () => {
    const manager = makeUser({ id: "emp-manager", role: "MANAGER" });
    getCurrentUserFromRequest.mockResolvedValue(manager);
    repoMocks.loadSnapshot.mockResolvedValue({
      leaveRequests: [makeLeaveRequest({ approverId: "emp-manager" })],
      employees: [makeUser({ id: "emp-2" })],
      leaveTypes: [{ id: "lt-casual", defaultDaysPerYear: 0 }],
    });

    const { POST } = await import("@/app/api/leave-requests/[id]/decide/route");
    const res = await POST(
      makeRequest("http://test/api/leave-requests/leave-1/decide", { method: "POST", body: JSON.stringify({ decision: "APPROVED" }) }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(repoMocks.decideLeaveRequest).toHaveBeenCalledWith("leave-1", "APPROVED", null, expect.any(String));
  });

  it("requires a comment when the approver rejects a request", async () => {
    const manager = makeUser({ id: "emp-manager", role: "MANAGER" });
    getCurrentUserFromRequest.mockResolvedValue(manager);
    repoMocks.loadSnapshot.mockResolvedValue({
      leaveRequests: [makeLeaveRequest({ approverId: "emp-manager" })],
      employees: [makeUser({ id: "emp-2" })],
      leaveTypes: [{ id: "lt-casual", defaultDaysPerYear: 0 }],
    });

    const { POST } = await import("@/app/api/leave-requests/[id]/decide/route");
    const res = await POST(
      makeRequest("http://test/api/leave-requests/leave-1/decide", { method: "POST", body: JSON.stringify({ decision: "REJECTED" }) }),
      { params }
    );

    expect(res.status).toBe(400);
    expect(repoMocks.decideLeaveRequest).not.toHaveBeenCalled();
  });
});

describe("POST /api/leave-requests/[id]/cancel — ownership-based authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  const params = Promise.resolve({ id: "leave-1" });

  it("rejects a different employee trying to cancel someone else's leave request", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ id: "emp-3", role: "EMPLOYEE" }));
    repoMocks.loadSnapshot.mockResolvedValue({ leaveRequests: [makeLeaveRequest({ employeeId: "emp-2" })], leaveBalances: [] });

    const { POST } = await import("@/app/api/leave-requests/[id]/cancel/route");
    const res = await POST(makeRequest("http://test/api/leave-requests/leave-1/cancel", { method: "POST" }), { params });

    expect(res.status).toBe(403);
    expect(repoMocks.cancelLeaveRequest).not.toHaveBeenCalled();
  });

  it("allows the requesting employee to cancel their own pending request", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ id: "emp-2", role: "EMPLOYEE" }));
    repoMocks.loadSnapshot.mockResolvedValue({ leaveRequests: [makeLeaveRequest({ employeeId: "emp-2" })], leaveBalances: [] });

    const { POST } = await import("@/app/api/leave-requests/[id]/cancel/route");
    const res = await POST(makeRequest("http://test/api/leave-requests/leave-1/cancel", { method: "POST" }), { params });

    expect(res.status).toBe(200);
    expect(repoMocks.cancelLeaveRequest).toHaveBeenCalledTimes(1);
  });
});
