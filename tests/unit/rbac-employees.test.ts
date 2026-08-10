import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeRequest, makeUser } from "./helpers/fixtures";

const { getCurrentUserFromRequest } = vi.hoisted(() => ({ getCurrentUserFromRequest: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserFromRequest }));

const repoMocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  insertEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  logAudit: vi.fn(),
  hydrateEmployee: vi.fn((_snapshot: unknown, employee: unknown) => employee),
}));
vi.mock("@/lib/db/repo", () => repoMocks);

vi.mock("@/lib/db/onboarding-repo", () => ({ checklistExists: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/invitation-service", () => ({ inviteEmployee: vi.fn().mockResolvedValue(undefined) }));

describe("GET /api/employees — direct API access as each role", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unauthenticated request", async () => {
    getCurrentUserFromRequest.mockResolvedValue(null);
    const { GET } = await import("@/app/api/employees/route");
    const res = await GET(makeRequest("http://test/api/employees"));
    expect(res.status).toBe(401);
  });

  it("rejects an EMPLOYEE trying to read the full company roster directly via the API", async () => {
    // The admin Employees page already 404s for non-admins, but the underlying data endpoint used
    // to have no role check at all — any signed-in employee could pull the entire directory
    // (including account status and onboarding state) with a direct API call. See the Guardrail
    // Audit finding this closes.
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ role: "EMPLOYEE" }));
    const { GET } = await import("@/app/api/employees/route");
    const res = await GET(makeRequest("http://test/api/employees"));
    expect(res.status).toBe(403);
    expect(repoMocks.loadSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a MANAGER trying to read the full company roster directly via the API", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ role: "MANAGER" }));
    const { GET } = await import("@/app/api/employees/route");
    const res = await GET(makeRequest("http://test/api/employees"));
    expect(res.status).toBe(403);
    expect(repoMocks.loadSnapshot).not.toHaveBeenCalled();
  });

  it("allows an ADMIN to read the full company roster", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ role: "ADMIN" }));
    repoMocks.loadSnapshot.mockResolvedValue({ employees: [makeUser({ id: "emp-2", name: "Someone Else" })] });
    const { GET } = await import("@/app/api/employees/route");
    const res = await GET(makeRequest("http://test/api/employees"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });
});

describe("POST /api/employees — direct API access as each role", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unauthenticated request", async () => {
    getCurrentUserFromRequest.mockResolvedValue(null);
    const { POST } = await import("@/app/api/employees/route");
    const res = await POST(makeRequest("http://test/api/employees", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("rejects an EMPLOYEE trying to add an employee directly via the API", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ role: "EMPLOYEE" }));
    const { POST } = await import("@/app/api/employees/route");
    const res = await POST(
      makeRequest("http://test/api/employees", {
        method: "POST",
        body: JSON.stringify({ name: "New Hire", email: "new.hire@example.com", title: "Engineer", departmentId: "dept-eng" }),
      })
    );
    expect(res.status).toBe(403);
    expect(repoMocks.insertEmployee).not.toHaveBeenCalled();
  });

  it("rejects a MANAGER trying to add an employee directly via the API", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ role: "MANAGER" }));
    const { POST } = await import("@/app/api/employees/route");
    const res = await POST(
      makeRequest("http://test/api/employees", {
        method: "POST",
        body: JSON.stringify({ name: "New Hire", email: "new.hire@example.com", title: "Engineer", departmentId: "dept-eng" }),
      })
    );
    expect(res.status).toBe(403);
    expect(repoMocks.insertEmployee).not.toHaveBeenCalled();
  });

  it("allows an ADMIN to add an employee", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ role: "ADMIN" }));
    repoMocks.loadSnapshot.mockResolvedValue({
      departments: [{ id: "dept-eng", name: "Engineering" }],
      employees: [],
    });
    const { POST } = await import("@/app/api/employees/route");
    const res = await POST(
      makeRequest("http://test/api/employees", {
        method: "POST",
        body: JSON.stringify({ name: "New Hire", email: "new.hire@example.com", title: "Engineer", departmentId: "dept-eng" }),
      })
    );
    expect(res.status).toBe(201);
    expect(repoMocks.insertEmployee).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/employees/[id] — direct API access as each role", () => {
  beforeEach(() => vi.clearAllMocks());

  const params = Promise.resolve({ id: "emp-2" });

  it("rejects an EMPLOYEE trying to edit another employee directly via the API", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ id: "emp-1", role: "EMPLOYEE" }));
    const { PATCH } = await import("@/app/api/employees/[id]/route");
    const res = await PATCH(makeRequest("http://test/api/employees/emp-2", { method: "PATCH", body: JSON.stringify({ role: "ADMIN" }) }), {
      params,
    });
    expect(res.status).toBe(403);
    expect(repoMocks.updateEmployee).not.toHaveBeenCalled();
  });

  it("rejects a MANAGER trying to edit an employee's role directly via the API", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ id: "emp-1", role: "MANAGER" }));
    const { PATCH } = await import("@/app/api/employees/[id]/route");
    const res = await PATCH(makeRequest("http://test/api/employees/emp-2", { method: "PATCH", body: JSON.stringify({ role: "ADMIN" }) }), {
      params,
    });
    expect(res.status).toBe(403);
    expect(repoMocks.updateEmployee).not.toHaveBeenCalled();
  });

  it("prevents an ADMIN from deactivating their own account", async () => {
    const admin = makeUser({ id: "emp-1", role: "ADMIN" });
    getCurrentUserFromRequest.mockResolvedValue(admin);
    repoMocks.loadSnapshot.mockResolvedValue({ departments: [], employees: [admin] });
    const { PATCH } = await import("@/app/api/employees/[id]/route");
    const res = await PATCH(makeRequest("http://test/api/employees/emp-1", { method: "PATCH", body: JSON.stringify({ status: "INACTIVE" }) }), {
      params: Promise.resolve({ id: "emp-1" }),
    });
    expect(res.status).toBe(400);
    expect(repoMocks.updateEmployee).not.toHaveBeenCalled();
  });

  it("allows an ADMIN to edit another employee", async () => {
    const admin = makeUser({ id: "emp-1", role: "ADMIN" });
    const target = makeUser({ id: "emp-2", role: "EMPLOYEE", name: "Target Employee" });
    getCurrentUserFromRequest.mockResolvedValue(admin);
    repoMocks.loadSnapshot.mockResolvedValue({ departments: [{ id: "dept-eng", name: "Engineering" }], employees: [admin, target] });
    const { PATCH } = await import("@/app/api/employees/[id]/route");
    const res = await PATCH(makeRequest("http://test/api/employees/emp-2", { method: "PATCH", body: JSON.stringify({ title: "Senior Engineer" }) }), {
      params,
    });
    expect(res.status).toBe(200);
    expect(repoMocks.updateEmployee).toHaveBeenCalledTimes(1);
  });
});
