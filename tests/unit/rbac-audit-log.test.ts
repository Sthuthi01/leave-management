import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeRequest, makeUser } from "./helpers/fixtures";

const { getCurrentUserFromRequest } = vi.hoisted(() => ({ getCurrentUserFromRequest: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserFromRequest }));

const repoMocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn().mockResolvedValue({ settings: { auditLogDisplayLimit: 200 } }),
  getAuditLog: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/db/repo", () => repoMocks);

describe("GET /api/audit-log — HR-Admin-only surface", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["EMPLOYEE", "MANAGER"] as const)("rejects a %s trying to view the audit log directly via the API", async (role) => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ role }));
    const { GET } = await import("@/app/api/audit-log/route");
    const res = await GET(makeRequest("http://test/api/audit-log"));
    expect(res.status).toBe(403);
    expect(repoMocks.getAuditLog).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    getCurrentUserFromRequest.mockResolvedValue(null);
    const { GET } = await import("@/app/api/audit-log/route");
    const res = await GET(makeRequest("http://test/api/audit-log"));
    expect(res.status).toBe(401);
  });

  it("allows an HR Admin to view the audit log", async () => {
    getCurrentUserFromRequest.mockResolvedValue(makeUser({ role: "ADMIN" }));
    const { GET } = await import("@/app/api/audit-log/route");
    const res = await GET(makeRequest("http://test/api/audit-log"));
    expect(res.status).toBe(200);
    expect(repoMocks.getAuditLog).toHaveBeenCalledTimes(1);
  });
});
