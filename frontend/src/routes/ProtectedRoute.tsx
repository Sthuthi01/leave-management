import { Navigate, Outlet } from "react-router-dom";
import { Spin } from "antd";
import { useCurrentUser } from "../hooks/useCurrentUser";

/** Redirects to /login if the `me` query 401s — the client-side equivalent of the source app's
 *  server-side getCurrentUser() + redirect("/login") in (app)/layout.tsx. */
export function ProtectedRoute() {
  const { data, isLoading, isError } = useCurrentUser();

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (isError || !data) return <Navigate to="/login" replace />;
  return <Outlet />;
}
