import { useState } from "react";
import { Avatar, Divider, Dropdown, Layout, Menu, Typography, type MenuProps } from "antd";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  BookOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  FileSearchOutlined,
  GiftOutlined,
  KeyOutlined,
  LogoutOutlined,
  ProfileOutlined,
  SendOutlined,
  SettingOutlined,
  SolutionOutlined,
  TagOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api-client";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { ChangePasswordModal } from "./ChangePasswordModal";

const ROLE_LABELS: Record<string, string> = { EMPLOYEE: "Employee", MANAGER: "Manager", ADMIN: "HR Admin" };

export function AppLayout() {
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout/"),
    onSuccess: () => {
      queryClient.setQueryData(["me"], null);
      queryClient.clear();
      window.location.href = "/login";
    },
  });

  const isAdmin = currentUser?.role === "ADMIN";

  const initials = currentUser?.name
    ? currentUser.name
        .split(" ")
        .map((word) => word[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

  const userMenu = (
    <div style={{ background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.15)", minWidth: 220, paddingBottom: 8 }}>
      <div style={{ padding: "12px 16px" }}>
        <div style={{ fontWeight: 600 }}>{currentUser?.name}</div>
        <div style={{ color: "#8c8c8c", fontSize: 13 }}>{currentUser?.email}</div>
      </div>
      <Divider style={{ margin: 0 }} />
      <div
        role="button"
        style={{ padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
        onClick={() => setChangePasswordOpen(true)}
      >
        <KeyOutlined /> Change password
      </div>
      <div
        role="button"
        style={{ padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#ff4d4f" }}
        onClick={() => logout.mutate()}
      >
        <LogoutOutlined /> Sign out
      </div>
    </div>
  );

  // Grouped to match the requested sidebar layout — permission gating per item is unchanged from
  // before (still exactly which items were already admin-only vs open to everyone), this only
  // reorganizes how they're grouped/labeled/iconified.
  const navItems: MenuProps["items"] = [
    { key: "/", icon: <AppstoreOutlined />, label: <Link to="/">Dashboard</Link> },
    {
      type: "group",
      label: "Leave",
      children: [
        { key: "/leave/apply", icon: <SendOutlined />, label: <Link to="/leave/apply">Apply Leave</Link> },
        { key: "/leave/my-leaves", icon: <CheckSquareOutlined />, label: <Link to="/leave/my-leaves">My Leaves</Link> },
        // Team Calendar is readable by everyone (scope-limited to the caller's own department
        // server-side unless they're admin) — matches the source app's nav-config, which never
        // role-gates this link either.
        { key: "/leave/team-calendar", icon: <CalendarOutlined />, label: <Link to="/leave/team-calendar">Team Calendar</Link> },
      ],
    },
    {
      type: "group",
      label: "Approvals",
      children: [
        // "Manager" is a relational concept (Employee.manager FK), not tied to Role.MANAGER — any
        // employee could be someone's assigned approver, so this link isn't role-gated either. The
        // page itself just shows an empty table if nothing is currently assigned to the viewer.
        { key: "/approvals", icon: <FileSearchOutlined />, label: <Link to="/approvals">My Approvals</Link> },
      ],
    },
    {
      type: "group",
      label: "Onboarding",
      children: [
        // Resource Library and My Checklist are unrestricted (server-side visibility filtering
        // does the real gating), matching the source app's nav-config, which never role-gates
        // these two links either.
        { key: "/onboarding/resources", icon: <BookOutlined />, label: <Link to="/onboarding/resources">Resource Library</Link> },
        { key: "/onboarding/checklist", icon: <ProfileOutlined />, label: <Link to="/onboarding/checklist">My Checklist</Link> },
      ],
    },
    ...(isAdmin ? [{ key: "/reports", icon: <BarChartOutlined />, label: <Link to="/reports">Reports</Link> }] : []),
    {
      type: "group",
      label: "Administration",
      children: [
        ...(isAdmin ? [{ key: "/employees", icon: <TeamOutlined />, label: <Link to="/employees">Employees</Link> }] : []),
        ...(isAdmin
          ? [{ key: "/departments", icon: <ApartmentOutlined />, label: <Link to="/departments">Departments</Link> }]
          : []),
        ...(isAdmin
          ? [{ key: "/leave-types", icon: <TagOutlined />, label: <Link to="/leave-types">Leave Types &amp; Policies</Link> }]
          : []),
        // Holidays: the backend's GET /api/holidays is open to any authenticated user (matches
        // the source app), but the source app's own nav/route still restricts the Holidays *page*
        // to ADMIN (whole "Administration" group is role-gated there) — so this link, like
        // Employees/Leave Types above, is admin-only too.
        ...(isAdmin ? [{ key: "/holidays", icon: <GiftOutlined />, label: <Link to="/holidays">Holidays</Link> }] : []),
        ...(isAdmin
          ? [
              {
                key: "/administration/onboarding",
                icon: <SolutionOutlined />,
                label: <Link to="/administration/onboarding">Onboarding Content</Link>,
              },
            ]
          : []),
        ...(isAdmin ? [{ key: "/audit-log", icon: <AuditOutlined />, label: <Link to="/audit-log">Audit Log</Link> }] : []),
        // Settings: GET is any signed-in user (consumed app-wide, e.g. leave-day calculation), PATCH
        // is admin-only — but the source app's own nav/route still restricts the Settings *page* to
        // ADMIN (same "Administration" group gating as Holidays above), so this link is admin-only.
        ...(isAdmin ? [{ key: "/settings", icon: <SettingOutlined />, label: <Link to="/settings">Settings</Link> }] : []),
      ],
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Sider
        theme="light"
        width={240}
        style={{ overflow: "auto", height: "100vh", position: "sticky", top: 0, left: 0, borderRight: "1px solid #f0f0f0" }}
      >
        <Typography.Title level={4} style={{ margin: 0, padding: "16px 24px", whiteSpace: "nowrap" }}>
          Agrileaf
        </Typography.Title>
        <Menu theme="light" mode="inline" selectedKeys={[location.pathname]} items={navItems} />
      </Layout.Sider>
      <Layout>
        <Layout.Header style={{ background: "#fff", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <Dropdown dropdownRender={() => userMenu} trigger={["click"]} placement="bottomRight">
            <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <Avatar style={{ backgroundColor: "#e6e6ff", color: "#4b3f96" }}>{initials}</Avatar>
              <div style={{ textAlign: "left", lineHeight: 1.3, whiteSpace: "nowrap" }}>
                <div style={{ fontWeight: 600 }}>{currentUser?.name}</div>
                <div style={{ color: "#8c8c8c", fontSize: 12 }}>{currentUser ? ROLE_LABELS[currentUser.role] : ""}</div>
              </div>
            </div>
          </Dropdown>
        </Layout.Header>
        <Layout.Content style={{ padding: 24 }}>
          <Outlet />
        </Layout.Content>
      </Layout>
      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </Layout>
  );
}
