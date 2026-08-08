import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { AppSettings } from "@/types";

export function useAppSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<AppSettings>("/settings"),
    staleTime: 5 * 60_000,
  });
}
