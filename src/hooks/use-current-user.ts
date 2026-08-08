import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { EmployeeWithRelations } from "@/types";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<EmployeeWithRelations>("/auth/me"),
  });
}
