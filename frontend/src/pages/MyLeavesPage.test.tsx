// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MyLeavesPage } from "./MyLeavesPage";
import { api } from "../lib/api-client";
import type { LeaveRequest, LeaveType } from "../types";

// jsdom doesn't implement matchMedia; AntD components that check viewport breakpoints need it.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Regression tests (Phase 7A) for the My Leaves page behaviors present on the source app's
// src/app/(app)/leave/my-leaves/page.tsx but dropped from the rewrite: the Applied column,
// detailed cancel-confirmation context, leave-balances cache invalidation on cancel, the custom
// empty state, friendly status labels, and leave-type color indicators.

vi.mock("../lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const mockedGet = vi.mocked(api.get);
const mockedPost = vi.mocked(api.post);

afterEach(cleanup);

function annualLeaveType(): LeaveType {
  return {
    id: 1,
    name: "Annual Leave",
    code: "AL",
    color: "#16a34a",
    default_days_per_year: 20,
    requires_approval: true,
    is_active: true,
    accrual_method: "ANNUAL",
    carry_forward_limit: 5,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function approvedRequest(): LeaveRequest {
  return {
    id: 42,
    reference_number: "LR-2026-0042",
    employee: { id: 1, name: "Employee Two", email: "employee2@test.local", department: { id: 1, name: "Engineering" } },
    leave_type: annualLeaveType(),
    start_date: "2026-09-01",
    end_date: "2026-09-02",
    days: 2,
    reason: "Trip",
    status: "APPROVED",
    approver: 2,
    approver_comment: null,
    applied_at: "2026-08-15T10:00:00Z",
    decided_at: "2026-08-15T11:00:00Z",
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <MyLeavesPage />
    </QueryClientProvider>
  ) };
}

describe("MyLeavesPage — restored regressions", () => {
  it("renders the page description", async () => {
    mockedGet.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("Every leave request you've submitted.")).toBeTruthy();
  });

  it("shows an Applied column with the request's submission date", async () => {
    mockedGet.mockResolvedValue([approvedRequest()]);
    renderPage();

    // "Applied" is the column header and renders immediately regardless of data; wait for the
    // actual row (which only appears once the query resolves) before checking its cell content.
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(await screen.findByText("LR-2026-0042")).toBeTruthy();
    expect(screen.getByText("15 Aug 2026")).toBeTruthy();
  });

  it("shows a friendly Title Case status label, not the raw enum value", async () => {
    mockedGet.mockResolvedValue([approvedRequest()]);
    renderPage();

    expect(await screen.findByText("Approved")).toBeTruthy();
    expect(screen.queryByText("APPROVED")).toBeNull();
  });

  it("shows a leave-type color indicator next to the leave type name", async () => {
    mockedGet.mockResolvedValue([approvedRequest()]);
    renderPage();

    await screen.findByText("Annual Leave");
    const dot = document.querySelector('span[style*="border-radius: 50%"]');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("style")).toContain("rgb(22, 163, 74)"); // #16a34a
  });

  it("shows the custom empty state when there are no leave requests", async () => {
    mockedGet.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("No leave requests")).toBeTruthy();
    expect(screen.getByText("Nothing here yet — try a different filter or apply for leave.")).toBeTruthy();
  });

  it("shows reference, leave type, dates, and a balance-refund note in the cancel confirmation for an approved request", async () => {
    mockedGet.mockResolvedValue([approvedRequest()]);
    renderPage();

    const cancelButton = await screen.findByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);

    expect(await screen.findByText("Cancel this leave request?")).toBeTruthy();
    expect(screen.getByText((_, el) => el?.textContent === "LR-2026-0042 — Annual Leave, 1 Sep 2026 – 2 Sep 2026. This will refund the days back to your balance.")).toBeTruthy();
  });

  it("invalidates leave-balances (in addition to leave-requests and dashboard) on a successful cancel", async () => {
    mockedGet.mockResolvedValue([approvedRequest()]);
    mockedPost.mockResolvedValue({ ...approvedRequest(), status: "CANCELLED" });
    const { queryClient } = renderPage();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const cancelButton = await screen.findByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);
    const confirmButton = await screen.findByRole("button", { name: "Cancel request" });
    fireEvent.click(confirmButton);

    await screen.findByText((_, el) => el?.textContent === "LR-2026-0042 cancelled." || false, {}, { timeout: 3000 }).catch(() => {
      // message.success renders via a portal outside this container in some AntD versions;
      // the invalidation assertions below are the real assertion either way.
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown[] }).queryKey));
    expect(invalidatedKeys).toContain(JSON.stringify(["leave-requests"]));
    expect(invalidatedKeys).toContain(JSON.stringify(["dashboard"]));
    expect(invalidatedKeys).toContain(JSON.stringify(["leave-balances"]));
  });
});
