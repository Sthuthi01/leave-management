import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";
import type { Employee } from "../types";

export function useCurrentUser() {
  return useQuery<Employee, ApiError>({
    queryKey: ["me"],
    queryFn: () => api.get<Employee>("/auth/me/"),
    retry: false,
  });
}
