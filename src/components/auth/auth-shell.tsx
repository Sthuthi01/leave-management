import Image from "next/image";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/** Shared centered-card layout for every pre-login page (sign in, forgot password, set password) —
 *  kept in one place so they stay visually consistent with each other and with the rest of the app. */
export function AuthShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Image src="/agrileaf-logo.png" alt="Agrileaf" width={71} height={40} className="mb-1 h-10 w-auto" priority />
          <CardTitle className="text-xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      </Card>
    </div>
  );
}
