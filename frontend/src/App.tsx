import { lazy, Suspense } from "react";
import { ConfigProvider, Spin } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { AdminRoute } from "./routes/AdminRoute";
import { AppLayout } from "./components/AppLayout";

// Route-level code splitting: each page ships as its own chunk, fetched on navigation instead of
// all being bundled into one ~3.4MB initial download (found during Prompt 4 production build
// verification). AppLayout/ProtectedRoute/AdminRoute stay eager — they're on the critical path for
// every authenticated route, so splitting them would just add a waterfall hop with no benefit.
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })));
const SetPasswordPage = lazy(() => import("./pages/SetPasswordPage").then((m) => ({ default: m.SetPasswordPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const ApplyLeavePage = lazy(() => import("./pages/ApplyLeavePage").then((m) => ({ default: m.ApplyLeavePage })));
const MyLeavesPage = lazy(() => import("./pages/MyLeavesPage").then((m) => ({ default: m.MyLeavesPage })));
const EmployeeListPage = lazy(() => import("./pages/EmployeeListPage").then((m) => ({ default: m.EmployeeListPage })));
const DepartmentsPage = lazy(() => import("./pages/DepartmentsPage").then((m) => ({ default: m.DepartmentsPage })));
const LeaveTypesPage = lazy(() => import("./pages/LeaveTypesPage").then((m) => ({ default: m.LeaveTypesPage })));
const HolidaysPage = lazy(() => import("./pages/HolidaysPage").then((m) => ({ default: m.HolidaysPage })));
const ApprovalsPage = lazy(() => import("./pages/ApprovalsPage").then((m) => ({ default: m.ApprovalsPage })));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage").then((m) => ({ default: m.AuditLogPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const TeamCalendarPage = lazy(() => import("./pages/TeamCalendarPage").then((m) => ({ default: m.TeamCalendarPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const OnboardingAdminPage = lazy(() => import("./pages/OnboardingAdminPage").then((m) => ({ default: m.OnboardingAdminPage })));
const ResourceLibraryPage = lazy(() => import("./pages/ResourceLibraryPage").then((m) => ({ default: m.ResourceLibraryPage })));
const MyChecklistPage = lazy(() => import("./pages/MyChecklistPage").then((m) => ({ default: m.MyChecklistPage })));

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

// Agrileaf brand green — matches the color used in the source app's email templates
// (backend/accounts/emails.py content) so Phase 1 already looks visually connected to the product.
const theme = { token: { colorPrimary: "#16a34a" } };

function PageFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 80 }}>
      <Spin size="large" />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={theme}>
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/set-password" element={<SetPasswordPage />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/leave/apply" element={<ApplyLeavePage />} />
                  <Route path="/leave/my-leaves" element={<MyLeavesPage />} />
                  <Route path="/approvals" element={<ApprovalsPage />} />
                  <Route path="/leave/team-calendar" element={<TeamCalendarPage />} />
                  <Route path="/onboarding/resources" element={<ResourceLibraryPage />} />
                  <Route path="/onboarding/checklist" element={<MyChecklistPage />} />
                  {/* Admin-only pages: gated the same way the source app's requireAdmin() gates
                      every /administration/* page — a non-admin who navigates here directly sees a
                      404, not the page shell, matching the source app's UX. Backend permission
                      classes are the real security boundary and are unchanged by this guard. */}
                  <Route element={<AdminRoute />}>
                    <Route path="/employees" element={<EmployeeListPage />} />
                    <Route path="/departments" element={<DepartmentsPage />} />
                    <Route path="/leave-types" element={<LeaveTypesPage />} />
                    <Route path="/holidays" element={<HolidaysPage />} />
                    <Route path="/audit-log" element={<AuditLogPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/administration/onboarding" element={<OnboardingAdminPage />} />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
