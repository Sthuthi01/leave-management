import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { HammerIcon } from "lucide-react";

export function ComingSoon({ title, description, icon: Icon = HammerIcon }: { title: string; description: string; icon?: LucideIcon }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Icon className="size-6 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div>
            <p className="font-medium">Coming soon</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">This module is planned for a follow-up release and isn&apos;t wired up yet.</p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
