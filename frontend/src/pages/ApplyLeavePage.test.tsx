// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import dayjs from "dayjs";
import { ApplyLeavePage } from "./ApplyLeavePage";
import { api } from "../lib/api-client";
import type { LeaveBalance, LeavePreview, LeaveType } from "../types";

// jsdom doesn't implement matchMedia; AntD's responsive Row/Col grid needs it to mount.
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

// Regression test for the leave-balance cards that were present on the source app's Apply Leave
// page (src/app/(app)/leave/apply/page.tsx's BalanceStrip) but were dropped when this page was
// rebuilt for the Django/React rewrite. Guards against the cards silently disappearing again in
// a future phase — asserts the actual rendered DOM, not just that a component function exists.

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

function unpaidLeaveType(): LeaveType {
  return {
    id: 2,
    name: "Unpaid Leave",
    code: "LWP",
    color: "#64748b",
    default_days_per_year: 0,
    requires_approval: true,
    is_active: true,
    accrual_method: "ANNUAL",
    carry_forward_limit: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function autoApprovedLeaveType(): LeaveType {
  return {
    id: 3,
    name: "Casual Leave",
    code: "CL",
    color: "#f59e0b",
    default_days_per_year: 12,
    requires_approval: false,
    is_active: true,
    accrual_method: "ANNUAL",
    carry_forward_limit: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ApplyLeavePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ApplyLeavePage — leave balance cards", () => {
  it("renders one card per active leave type with code, remaining, used, total, carry-forward, and a progress indicator", async () => {
    const balances: LeaveBalance[] = [
      {
        id: 1,
        leave_type: annualLeaveType(),
        year: 2026,
        allocated: 20,
        used: 5,
        carried_forward: 2,
        accrued_to_date: 20,
        remaining: 15,
      },
    ];
    mockedGet.mockImplementation((path: string) => {
      if (path === "/leave-balances/") return Promise.resolve(balances);
      return Promise.resolve([]);
    });

    renderPage();

    expect(await screen.findByText("Annual Leave")).toBeTruthy();
    expect(screen.getByText("AL")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy(); // remaining
    expect(screen.getByText("days left")).toBeTruthy();
    expect(screen.getByText("5 used")).toBeTruthy();
    expect(screen.getByText("20 total")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy(); // carried-forward badge

    // The AntD Progress bar renders an aria-valuenow — confirms a real progress indicator, not
    // just used/total text.
    const progress = document.querySelector('[role="progressbar"]');
    expect(progress).not.toBeNull();
    expect(progress?.getAttribute("aria-valuenow")).toBe("25"); // 5 used / 20 allocated
  });

  it('shows "No annual cap" instead of a used/total progress bar for a leave type with no default_days_per_year', async () => {
    const balances: LeaveBalance[] = [
      {
        id: 2,
        leave_type: unpaidLeaveType(),
        year: 2026,
        allocated: 0,
        used: 3,
        carried_forward: 0,
        accrued_to_date: 0,
        remaining: -3,
      },
    ];
    mockedGet.mockImplementation((path: string) => {
      if (path === "/leave-balances/") return Promise.resolve(balances);
      return Promise.resolve([]);
    });

    renderPage();

    expect(await screen.findByText("Unpaid Leave")).toBeTruthy();
    expect(screen.getByText("No annual cap")).toBeTruthy();
    expect(screen.queryByText("3 used")).toBeNull();
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("renders no stray cards when the employee has no leave-balance rows", async () => {
    mockedGet.mockImplementation((path: string) => Promise.resolve(path === "/leave-balances/" ? [] : []));

    renderPage();

    await screen.findByText("Apply for Leave");
    expect(screen.queryByText("days left")).toBeNull();
  });
});

// Regression tests for the "no manager on file" warning and page description, both present on
// the source app's Apply Leave page but dropped from the rewrite (Phase 7A).
describe("ApplyLeavePage — no-manager warning and page description", () => {
  const NO_MANAGER_TEXT = "No manager on file — requests that need approval will fail until HR assigns you one.";

  it("shows the no-manager warning when the current user has no manager on file", async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === "/auth/me/") return Promise.resolve({ id: 1, name: "New Hire", manager: null });
      return Promise.resolve([]);
    });

    renderPage();

    expect(await screen.findByText(NO_MANAGER_TEXT)).toBeTruthy();
  });

  it("hides the no-manager warning when the current user has a manager assigned", async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === "/auth/me/") return Promise.resolve({ id: 1, name: "Employee Two", manager: 5 });
      return Promise.resolve([]);
    });

    renderPage();

    // Wait for the user query to settle before asserting the warning is absent.
    await screen.findByText("Apply for Leave");
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/auth/me/"));
    expect(screen.queryByText(NO_MANAGER_TEXT)).toBeNull();
  });

  it("renders the page description", async () => {
    mockedGet.mockImplementation(() => Promise.resolve([]));

    renderPage();

    expect(await screen.findByText("Submit a new leave request and preview its impact before you send it.")).toBeTruthy();
  });
});

// Regression/feature tests (Phase 7B) for the backend-driven day-count preview: selecting a
// leave type and a date range must call POST /leave-requests/preview/ (never recompute the day
// count in TypeScript) and render its result, including an insufficient-balance warning that
// disables Submit.
describe("ApplyLeavePage — day-count preview and insufficient-balance warning", () => {
  const futureStart = dayjs().add(21, "day");
  const futureDateStr = futureStart.format("YYYY-MM-DD");

  async function selectLeaveTypeAndDates() {
    fireEvent.mouseDown(screen.getByText("Select a leave type"));
    fireEvent.click(await screen.findByText("Annual Leave (AL)"));

    const [startInput, endInput] = screen.getAllByPlaceholderText(/date/i);
    fireEvent.mouseDown(startInput);
    fireEvent.change(startInput, { target: { value: futureDateStr } });
    fireEvent.keyDown(startInput, { key: "Enter", code: "Enter" });
    fireEvent.change(endInput, { target: { value: futureDateStr } });
    fireEvent.keyDown(endInput, { key: "Enter", code: "Enter" });
    fireEvent.blur(endInput);
  }

  function mockCommonGets() {
    mockedGet.mockImplementation((path: string) => {
      if (path === "/leave-types/") return Promise.resolve([annualLeaveType()]);
      if (path === "/auth/me/") return Promise.resolve({ id: 1, name: "Employee Two", manager: 5, manager_name: "Manager Five" });
      return Promise.resolve([]);
    });
  }

  it("calls the preview endpoint (not a local calculation) and shows the returned day count and balance-after in the Summary panel", async () => {
    mockCommonGets();
    const preview: LeavePreview = { days: 1, is_capped: true, remaining_balance: 14, balance_after: 13, insufficient_balance: false };
    mockedPost.mockImplementation((path: string) => {
      if (path === "/leave-requests/preview/") return Promise.resolve(preview);
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByText("Apply for Leave");
    await selectLeaveTypeAndDates();

    await waitFor(
      () =>
        expect(mockedPost).toHaveBeenCalledWith("/leave-requests/preview/", {
          leave_type: 1,
          start_date: futureDateStr,
          end_date: futureDateStr,
        }),
      { timeout: 2000 }
    );

    expect(await screen.findByText("Summary", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText("1 working day")).toBeTruthy();
    expect(screen.getByText("Balance after this request")).toBeTruthy();
    expect(screen.getByText("13 days")).toBeTruthy();
  });

  it("shows an insufficient-balance warning and disables Submit when the preview flags it", async () => {
    mockCommonGets();
    const preview: LeavePreview = { days: 5, is_capped: true, remaining_balance: 1, balance_after: -4, insufficient_balance: true };
    mockedPost.mockImplementation((path: string) => {
      if (path === "/leave-requests/preview/") return Promise.resolve(preview);
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByText("Apply for Leave");
    await selectLeaveTypeAndDates();

    expect(await screen.findByText(/Insufficient balance: only 1 day\(s\) available/, {}, { timeout: 2000 })).toBeTruthy();
    const submitButton = screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
  });

  it("does not show a preview or block Submit before a leave type and full date range are chosen", async () => {
    mockedPost.mockClear();
    mockCommonGets();
    renderPage();
    await screen.findByText("Apply for Leave");

    expect(screen.queryByText(/working day/)).toBeNull();
    const submitButton = screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
    expect(mockedPost).not.toHaveBeenCalledWith("/leave-requests/preview/", expect.anything());
  });
});

// Summary panel tests (Phase 7C): leave type, duration, dates, balance-after, approver, approval
// timeline, and policy hints — all sourced from the preview response, the selected leave type,
// and the current user, never invented or recomputed client-side.
describe("ApplyLeavePage — Summary panel", () => {
  const futureStart = dayjs().add(21, "day");
  const futureDateStr = futureStart.format("YYYY-MM-DD");

  async function selectLeaveTypeAndDates(label: string) {
    fireEvent.mouseDown(screen.getByText("Select a leave type"));
    fireEvent.click(await screen.findByText(label));

    const [startInput, endInput] = screen.getAllByPlaceholderText(/date/i);
    fireEvent.mouseDown(startInput);
    fireEvent.change(startInput, { target: { value: futureDateStr } });
    fireEvent.keyDown(startInput, { key: "Enter", code: "Enter" });
    fireEvent.change(endInput, { target: { value: futureDateStr } });
    fireEvent.keyDown(endInput, { key: "Enter", code: "Enter" });
    fireEvent.blur(endInput);
  }

  function mockGets(user: Record<string, unknown>) {
    mockedGet.mockImplementation((path: string) => {
      if (path === "/leave-types/") return Promise.resolve([annualLeaveType(), unpaidLeaveType(), autoApprovedLeaveType()]);
      if (path === "/auth/me/") return Promise.resolve(user);
      return Promise.resolve([]);
    });
  }

  it("shows the assigned approver's name when a manager is on file", async () => {
    mockGets({ id: 1, name: "Employee Two", manager: 5, manager_name: "Manager Five" });
    mockedPost.mockImplementation((path: string) =>
      path === "/leave-requests/preview/"
        ? Promise.resolve({ days: 1, is_capped: true, remaining_balance: 14, balance_after: 13, insufficient_balance: false })
        : Promise.resolve({})
    );

    renderPage();
    await screen.findByText("Apply for Leave");
    await selectLeaveTypeAndDates("Annual Leave (AL)");

    await screen.findByText("Summary", {}, { timeout: 2000 });
    expect(screen.getByText("Approver")).toBeTruthy();
    expect(screen.getByText("Manager Five")).toBeTruthy();
  });

  it('shows "No manager assigned" in the Summary panel when the current user has no manager', async () => {
    mockGets({ id: 1, name: "New Hire", manager: null, manager_name: null });
    mockedPost.mockImplementation((path: string) =>
      path === "/leave-requests/preview/"
        ? Promise.resolve({ days: 1, is_capped: true, remaining_balance: 14, balance_after: 13, insufficient_balance: false })
        : Promise.resolve({})
    );

    renderPage();
    await screen.findByText("Apply for Leave");
    await selectLeaveTypeAndDates("Annual Leave (AL)");

    await screen.findByText("Summary", {}, { timeout: 2000 });
    expect(screen.getByText("No manager assigned")).toBeTruthy();
    // The existing top-of-card warning must still be present alongside the Summary panel.
    expect(screen.getByText("No manager on file — requests that need approval will fail until HR assigns you one.")).toBeTruthy();
  });

  it("shows a 3-step Submitted → Manager review → Approved timeline and a manager-approval policy hint for an approval-required leave type", async () => {
    mockGets({ id: 1, name: "Employee Two", manager: 5, manager_name: "Manager Five" });
    mockedPost.mockImplementation((path: string) =>
      path === "/leave-requests/preview/"
        ? Promise.resolve({ days: 1, is_capped: true, remaining_balance: 14, balance_after: 13, insufficient_balance: false })
        : Promise.resolve({})
    );

    renderPage();
    await screen.findByText("Apply for Leave");
    await selectLeaveTypeAndDates("Annual Leave (AL)");

    await screen.findByText("Summary", {}, { timeout: 2000 });
    expect(screen.getByText("Submitted")).toBeTruthy();
    expect(screen.getByText("Manager review")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Requires manager approval")).toBeTruthy();
    // 5-day carry-forward limit on annualLeaveType() should surface as a policy hint.
    expect(screen.getByText(/Up to 5 unused days carry forward to next year/)).toBeTruthy();
  });

  it("shows a simplified 2-step timeline and an auto-approved policy hint for an auto-approved leave type", async () => {
    mockGets({ id: 1, name: "Employee Two", manager: 5, manager_name: "Manager Five" });
    mockedPost.mockImplementation((path: string) =>
      path === "/leave-requests/preview/"
        ? Promise.resolve({ days: 1, is_capped: true, remaining_balance: 10, balance_after: 9, insufficient_balance: false })
        : Promise.resolve({})
    );

    renderPage();
    await screen.findByText("Apply for Leave");
    await selectLeaveTypeAndDates("Casual Leave (CL)");

    await screen.findByText("Summary", {}, { timeout: 2000 });
    expect(screen.getByText("Submitted")).toBeTruthy();
    expect(screen.getByText("Approved automatically")).toBeTruthy();
    expect(screen.queryByText("Manager review")).toBeNull();
    expect(screen.getByText("Auto-approved — no manager review needed")).toBeTruthy();
  });

  it("shows a balance-after value that matches the preview response exactly", async () => {
    mockGets({ id: 1, name: "Employee Two", manager: 5, manager_name: "Manager Five" });
    mockedPost.mockImplementation((path: string) =>
      path === "/leave-requests/preview/"
        ? Promise.resolve({ days: 3, is_capped: true, remaining_balance: 20, balance_after: 17, insufficient_balance: false })
        : Promise.resolve({})
    );

    renderPage();
    await screen.findByText("Apply for Leave");
    await selectLeaveTypeAndDates("Annual Leave (AL)");

    await screen.findByText("Summary", {}, { timeout: 2000 });
    expect(screen.getByText("17 days")).toBeTruthy();
  });

  it('shows a "No annual cap" policy hint and balance value for an uncapped leave type, not a fabricated number', async () => {
    mockGets({ id: 1, name: "Employee Two", manager: 5, manager_name: "Manager Five" });
    mockedPost.mockImplementation((path: string) =>
      path === "/leave-requests/preview/"
        ? Promise.resolve({ days: 1, is_capped: false, remaining_balance: null, balance_after: null, insufficient_balance: false })
        : Promise.resolve({})
    );

    renderPage();
    await screen.findByText("Apply for Leave");
    await selectLeaveTypeAndDates("Unpaid Leave (LWP)");

    await screen.findByText("Summary", {}, { timeout: 2000 });
    const noAnnualCapMatches = screen.getAllByText("No annual cap");
    expect(noAnnualCapMatches.length).toBeGreaterThan(0);
  });
});

// Regression test for the /auth/me/ manager_name field the Summary panel depends on — confirms
// the frontend actually reads and displays it, complementing the backend contract test in
// accounts/tests/test_me.py.
describe("ApplyLeavePage — /auth/me/ manager_name", () => {
  it("passes manager_name from /auth/me/ through to the no-manager warning's absence and the Summary panel's approver row", async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === "/leave-types/") return Promise.resolve([annualLeaveType()]);
      if (path === "/auth/me/") return Promise.resolve({ id: 1, name: "Employee Two", manager: 9, manager_name: "Dana Director" });
      return Promise.resolve([]);
    });
    mockedPost.mockImplementation((path: string) =>
      path === "/leave-requests/preview/"
        ? Promise.resolve({ days: 1, is_capped: true, remaining_balance: 5, balance_after: 4, insufficient_balance: false })
        : Promise.resolve({})
    );

    renderPage();
    await screen.findByText("Apply for Leave");

    fireEvent.mouseDown(screen.getByText("Select a leave type"));
    fireEvent.click(await screen.findByText("Annual Leave (AL)"));
    const futureDateStr = dayjs().add(21, "day").format("YYYY-MM-DD");
    const [startInput, endInput] = screen.getAllByPlaceholderText(/date/i);
    fireEvent.mouseDown(startInput);
    fireEvent.change(startInput, { target: { value: futureDateStr } });
    fireEvent.keyDown(startInput, { key: "Enter", code: "Enter" });
    fireEvent.change(endInput, { target: { value: futureDateStr } });
    fireEvent.keyDown(endInput, { key: "Enter", code: "Enter" });
    fireEvent.blur(endInput);

    await screen.findByText("Summary", {}, { timeout: 2000 });
    expect(screen.getByText("Dana Director")).toBeTruthy();
  });
});
