import { Outlet } from "react-router-dom";
import { Result, Spin } from "antd";
import { useCurrentUser } from "../hooks/useCurrentUser";

/** Client-side equivalent of the source app's per-page `requireAdmin()` (src/lib/require-admin.ts),
 *  which calls Next.js `notFound()` for a non-admin. Backend permission classes remain the real
 *  security boundary — this only stops a non-admin who directly navigates to an admin URL from
 *  seeing the page shell and its (would-be-403'd) data, matching the source app's UX. */
export function AdminRoute() {
  const { data, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (data?.role !== "ADMIN") {
    return <Result status="404" title="Page not found" />;
  }
  return <Outlet />;
}
