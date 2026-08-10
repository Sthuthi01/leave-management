import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeRequest, makeUser } from "./helpers/fixtures";
import type { LeaveRequest } from "@/types";

const { getCurrentUserFromRequest } = vi.hoisted(() => ({ getCurrentUserFromRequest: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserFromRequest }));

const repoMocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  // Both resolve true by default — real callers only get false when a concurrent request already
  // won the atomic PENDING -> decision/cancel transition (see the dedicated race-guard tests
  // below), so every other test in this file exercises the ordinary single-request success path.
  decideLeaveRequestTx: vi.fn().mockResolvedValue(true),
  cancelLeaveRequestTx: vi.fn().mockResolvedValue(true),
  applyLeaveRequestAtomic: vi.fn(),
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
    expect(repoMocks.decideLeaveRequestTx).not.toHaveBeenCalled();
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
    expect(repoMocks.decideLeaveRequestTx).not.toHaveBeenCalled();
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
    // Uncapped leave type (defaultDaysPerYear: 0) -> no balance adjustment to make, so the 5th arg
    // (the atomic transaction's balance-adjustment instruction) must be null, not an object.
    expect(repoMocks.decideLeaveRequestTx).toHaveBeenCalledWith("leave-1", "APPROVED", null, expect.any(String), null);
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
    expect(repoMocks.decideLeaveRequestTx).not.toHaveBeenCalled();
  });

  it("returns 409 and never logs an audit entry if a concurrent request already decided it", async () => {
    // decideLeaveRequestTx's WHERE clause only matches a still-PENDING row — false here simulates
    // another request (a double-click, a race) having already won that atomic transition. The
    // balance adjustment (if any) is applied INSIDE decideLeaveRequestTx's own transaction only
    // when the status transition itself succeeds, so a false return here guarantees the balance
    // was never touched — that guarantee is what the concurrent live test (see the P0 fix
    // verification) proves against a real database; this test proves the route correctly stops
    // and never proceeds to log an audit entry for a decision that didn't actually happen.
    repoMocks.decideLeaveRequestTx.mockResolvedValueOnce(false);
    const manager = makeUser({ id: "emp-manager", role: "MANAGER" });
    getCurrentUserFromRequest.mockResolvedValue(manager);
    repoMocks.loadSnapshot.mockResolvedValue({
      leaveRequests: [makeLeaveRequest({ approverId: "emp-manager" })],
      employees: [makeUser({ id: "emp-2" })],
      leaveTypes: [{ id: "lt-casual", defaultDaysPerYear: 12 }],
    });

    const { POST } = await import("@/app/api/leave-requests/[id]/decide/route");
    const res = await POST(
      makeRequest("http://test/api/leave-requests/leave-1/decide", { method: "POST", body: JSON.stringify({ decision: "APPROVED" }) }),
      { params }
    );

    expect(res.status).toBe(409);
    // Confirms the balance-adjustment instruction was computed correctly (proving the route would
    // have applied it had the transition succeeded) without actually touching the database for it.
    expect(repoMocks.decideLeaveRequestTx).toHaveBeenCalledWith(
      "leave-1",
      "APPROVED",
      null,
      expect.any(String),
      { employeeId: "emp-2", leaveTypeId: "lt-casual", year: 2026, days: 2 }
    );
    expect(repoMocks.logAudit).not.toHaveBeenCalled();
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
    expect(repoMocks.cancelLeaveRequestTx).not.toHaveBeenCalled();
  });

  it("allows the requesting employee to cancel their own pending request", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ id: "emp-2", role: "EMPLOYEE" }));
    repoMocks.loadSnapshot.mockResolvedValue({ leaveRequests: [makeLeaveRequest({ employeeId: "emp-2" })], leaveBalances: [] });

    const { POST } = await import("@/app/api/leave-requests/[id]/cancel/route");
    const res = await POST(makeRequest("http://test/api/leave-requests/leave-1/cancel", { method: "POST" }), { params });

    expect(res.status).toBe(200);
    expect(repoMocks.cancelLeaveRequestTx).toHaveBeenCalledTimes(1);
  });

  it("returns 409 and never logs an audit entry if the request's status already changed", async () => {
    // cancelLeaveRequestTx's WHERE clause only matches a still PENDING/APPROVED row — false here
    // simulates a concurrent decide/cancel having already changed it. The balance release (if
    // any) happens INSIDE cancelLeaveRequestTx's own transaction only when the status change
    // itself succeeds — proven against a real database by the concurrent live test in the P0 fix
    // verification. This test proves the route stops and never logs an audit entry for a cancel
    // that didn't actually happen.
    repoMocks.cancelLeaveRequestTx.mockResolvedValueOnce(false);
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ id: "emp-2", role: "EMPLOYEE" }));
    repoMocks.loadSnapshot.mockResolvedValue({
      leaveRequests: [makeLeaveRequest({ employeeId: "emp-2", status: "APPROVED" })],
      leaveBalances: [{ employeeId: "emp-2", leaveTypeId: "lt-casual", year: 2026, used: 2, allocated: 12, carriedForward: 0 }],
    });

    const { POST } = await import("@/app/api/leave-requests/[id]/cancel/route");
    const res = await POST(makeRequest("http://test/api/leave-requests/leave-1/cancel", { method: "POST" }), { params });

    expect(res.status).toBe(409);
    // Confirms the release amount was computed correctly (negative delta, to release days) without
    // actually touching the database for it, since the status change itself never took effect.
    expect(repoMocks.cancelLeaveRequestTx).toHaveBeenCalledWith("leave-1", expect.any(String), {
      employeeId: "emp-2",
      leaveTypeId: "lt-casual",
      year: 2026,
      days: -2,
    });
    expect(repoMocks.logAudit).not.toHaveBeenCalled();
  });
});

describe("POST /api/leave-requests — applyLeaveRequestAtomic result handling", () => {
  // The actual concurrency guarantee (the per-employee advisory lock + fresh in-transaction
  // overlap/balance checks) is a real-database property, not something a mock can exercise
  // meaningfully — that's proven separately by a live concurrent-request test against a real
  // Postgres instance (see the P0 fix verification: 5 identical concurrent submissions produced
  // exactly 1 success and 4 correctly-rejected duplicates). What belongs here, at the unit level,
  // is that this route calls applyLeaveRequestAtomic (rather than the old direct-insert path) and
  // correctly turns each of its three possible outcomes into the right HTTP response.
  beforeEach(() => vi.clearAllMocks());

  const baseSnapshot = {
    leaveTypes: [{ id: "lt-casual", name: "Casual Leave", isActive: true, defaultDaysPerYear: 12, requiresApproval: true, carryForwardLimit: 5, accrualMethod: "ANNUAL" }],
    holidays: [],
    settings: { workingDays: [1, 2, 3, 4, 5] },
    employees: [],
  };

  it("applies via applyLeaveRequestAtomic and returns 201 on success", async () => {
    const user = makeUser({ id: "emp-2", managerId: "emp-manager" });
    getCurrentUserFromRequest.mockResolvedValue(user);
    repoMocks.loadSnapshot.mockResolvedValue(baseSnapshot);
    repoMocks.applyLeaveRequestAtomic.mockResolvedValue({
      ok: true,
      request: {
        id: "leave-new",
        referenceNumber: "LR-2026-0099",
        employeeId: "emp-2",
        leaveTypeId: "lt-casual",
        startDate: "2026-09-07",
        endDate: "2026-09-08",
        days: 2,
        reason: "Trip",
        status: "PENDING",
        approverId: "emp-manager",
        approverComment: null,
        appliedAt: "2026-09-01T00:00:00.000Z",
        decidedAt: null,
      },
    });

    const { POST } = await import("@/app/api/leave-requests/route");
    const res = await POST(
      makeRequest("http://test/api/leave-requests", {
        method: "POST",
        body: JSON.stringify({ leaveTypeId: "lt-casual", startDate: "2026-09-07", endDate: "2026-09-08", reason: "Trip" }),
      })
    );

    expect(res.status).toBe(201);
    expect(repoMocks.applyLeaveRequestAtomic).toHaveBeenCalledTimes(1);
    const [, employeeArg, leaveTypeArg, paramsArg] = repoMocks.applyLeaveRequestAtomic.mock.calls[0];
    expect(employeeArg.id).toBe("emp-2");
    expect(leaveTypeArg.id).toBe("lt-casual");
    expect(paramsArg).toMatchObject({ startDate: "2026-09-07", endDate: "2026-09-08", requiresApproval: true, approverId: "emp-manager" });
    expect(repoMocks.logAudit).toHaveBeenCalledTimes(1);
  });

  it("surfaces an OVERLAP result as a 400 naming the conflicting request", async () => {
    const user = makeUser({ id: "emp-2", managerId: "emp-manager" });
    getCurrentUserFromRequest.mockResolvedValue(user);
    repoMocks.loadSnapshot.mockResolvedValue(baseSnapshot);
    repoMocks.applyLeaveRequestAtomic.mockResolvedValue({
      ok: false,
      reason: "OVERLAP",
      overlapping: { referenceNumber: "LR-2026-0050", status: "APPROVED", startDate: "2026-09-07", endDate: "2026-09-08" },
    });

    const { POST } = await import("@/app/api/leave-requests/route");
    const res = await POST(
      makeRequest("http://test/api/leave-requests", {
        method: "POST",
        body: JSON.stringify({ leaveTypeId: "lt-casual", startDate: "2026-09-07", endDate: "2026-09-08", reason: "Trip" }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("LR-2026-0050");
    expect(repoMocks.logAudit).not.toHaveBeenCalled();
  });

  it("surfaces an INSUFFICIENT_BALANCE result as a 400 naming the available days", async () => {
    const user = makeUser({ id: "emp-2", managerId: "emp-manager" });
    getCurrentUserFromRequest.mockResolvedValue(user);
    repoMocks.loadSnapshot.mockResolvedValue(baseSnapshot);
    repoMocks.applyLeaveRequestAtomic.mockResolvedValue({ ok: false, reason: "INSUFFICIENT_BALANCE", available: 1 });

    const { POST } = await import("@/app/api/leave-requests/route");
    const res = await POST(
      makeRequest("http://test/api/leave-requests", {
        method: "POST",
        body: JSON.stringify({ leaveTypeId: "lt-casual", startDate: "2026-09-07", endDate: "2026-09-08", reason: "Trip" }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("1 day(s) available");
    expect(repoMocks.logAudit).not.toHaveBeenCalled();
  });
});
