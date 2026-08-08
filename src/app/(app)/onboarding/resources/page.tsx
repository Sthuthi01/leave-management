"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resourceVisibleToEmployee } from "@/lib/onboarding";
import { resourceContentTypeMeta } from "@/components/onboarding/resource-type-indicator";
import type { OnboardingResource, ResourceCategory } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ResourceCategoryBadge } from "@/components/onboarding/resource-category-badge";
import { ResourceRequiredBadge } from "@/components/onboarding/resource-required-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { SearchIcon, BookOpenIcon, ExternalLinkIcon, PaperclipIcon, FileTextIcon, DownloadIcon, ChevronRightIcon, XIcon } from "lucide-react";

type CategoryFilter = ResourceCategory | "ALL";

const TABS: { key: CategoryFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "GUIDE", label: "Guides" },
  { key: "POLICY", label: "Policies" },
  { key: "TRAINING", label: "Training" },
];

export default function ResourceLibraryPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [open, setOpen] = useState<OnboardingResource | null>(null);

  const { data: user, isPending: userPending } = useCurrentUser();
  const { data: resources, isPending: resourcesPending } = useQuery({
    queryKey: ["onboarding-resources"],
    queryFn: () => api.get<OnboardingResource[]>("/onboarding/resources"),
  });

  const visible = useMemo(() => {
    if (!user) return [];
    return (resources ?? []).filter((r) => resourceVisibleToEmployee(r, user));
  }, [resources, user]);

  const isFiltered = search.trim().length > 0 || category !== "ALL";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visible
      .filter((r) => category === "ALL" || r.category === category)
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  }, [visible, search, category]);

  function clearFilters() {
    setSearch("");
    setCategory("ALL");
  }

  const isPending = userPending || resourcesPending;

  return (
    <>
      <PageHeader title="Resource Library" description="Guides, policies, and training materials to help you get up to speed." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search resources..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Tabs value={category} onValueChange={(v) => setCategory(v as CategoryFilter)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent>
            {visible.length === 0 ? (
              <EmptyState
                icon={BookOpenIcon}
                title="No resources yet"
                description="Your HR team hasn't published any onboarding resources for you yet. Check back soon."
              />
            ) : (
              <EmptyState
                icon={SearchIcon}
                title="No resources found"
                description="Try a different search term, or switch to a different category."
                action={
                  isFiltered && (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      <XIcon /> Clear filters
                    </Button>
                  )
                }
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => {
            const typeMeta = resourceContentTypeMeta(r);
            const TypeIcon = typeMeta.icon;
            return (
              <button key={r.id} type="button" onClick={() => setOpen(r)} className="text-left">
                <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/30">
                  <CardContent className="flex h-full flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{r.title}</p>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <ResourceCategoryBadge category={r.category} />
                        <ResourceRequiredBadge isRequired={r.isRequired} />
                      </div>
                    </div>
                    <p className="line-clamp-3 text-sm text-muted-foreground">{r.description}</p>

                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2.5 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <TypeIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{typeMeta.label}</span>
                        {r.attachments.length > 0 && (
                          <span className="flex shrink-0 items-center gap-0.5">
                            <PaperclipIcon className="size-3" />
                            {r.attachments.length}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5 font-medium text-primary">
                        {typeMeta.action}
                        <ChevronRightIcon className="size-3.5" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{open?.title}</DialogTitle>
            {open && (
              <div className="flex items-center gap-2">
                <ResourceCategoryBadge category={open.category} />
                <ResourceRequiredBadge isRequired={open.isRequired} />
              </div>
            )}
            {open?.description && <DialogDescription>{open.description}</DialogDescription>}
          </DialogHeader>

          {open?.document && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <FileTextIcon className="size-4 shrink-0 text-primary" />
                <span className="truncate">{open.document.fileName}</span>
              </span>
              <Button
                size="sm"
                nativeButton={false}
                render={<a href={`/api/onboarding/resources/${open.id}/document`} target="_blank" rel="noreferrer" />}
              >
                <DownloadIcon className="size-3.5" /> View / Download
              </Button>
            </div>
          )}

          {open?.content && <p className="text-sm whitespace-pre-line text-muted-foreground">{open.content}</p>}

          {open && open.attachments.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">Attachments</p>
              {open.attachments.map((a) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <PaperclipIcon className="size-3.5" /> {a.name}
                </a>
              ))}
            </div>
          )}

          <DialogFooter>
            {open?.url && (
              <Button variant="outline" nativeButton={false} render={<a href={open.url} target="_blank" rel="noreferrer" />}>
                <ExternalLinkIcon /> Open link
              </Button>
            )}
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
