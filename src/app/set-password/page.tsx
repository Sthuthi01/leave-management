"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { passwordSchema } from "@/lib/password-rules";
import { AuthShell } from "@/components/auth/auth-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2Icon, ShieldAlertIcon, ArrowLeftIcon } from "lucide-react";

interface TokenCheckResponse {
  valid: boolean;
  purpose?: "INVITE" | "RESET";
  name?: string;
  email?: string;
  reason?: "INVALID" | "EXPIRED" | "USED";
  message?: string;
}

const schema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: "Passwords do not match.", path: ["confirmPassword"] });
type FormValues = z.infer<typeof schema>;

function SetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { data, isPending } = useQuery({
    queryKey: ["set-password-token", token],
    queryFn: () => api.get<TokenCheckResponse>(`/auth/set-password?token=${encodeURIComponent(token)}`),
  });
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { password: "", confirmPassword: "" } });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      await api.post("/auth/set-password", { token, password: values.password });
      toast.success(data?.purpose === "RESET" ? "Password reset. You're signed in." : "Account activated. You're signed in.");
      // router.push() alone already fetches a fresh RSC payload for the destination route (using
      // the just-set session cookie), so a follow-up router.refresh() is redundant — and, fired
      // immediately after push() before React has committed the navigation, it raced with this
      // page's own Suspense/useSearchParams-driven render and intermittently left the client stuck
      // on this page after a successful submission (confirmed via repeated E2E runs correlating
      // with server-side "destination stream closed early" errors, and ruled out as a test-timing
      // issue by a clean manual reproduction of the same flow).
      router.push("/");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (isPending) {
    return (
      <AuthShell title="Set up your account" description="Choose a password to finish setting up your account.">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </AuthShell>
    );
  }

  if (!data?.valid) {
    return (
      <AuthShell title="Account access">
        <EmptyState
          icon={ShieldAlertIcon}
          title="This link can't be used"
          description={data?.message ?? "This link isn't valid. Please check the link or ask for a new one."}
          action={
            <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <ArrowLeftIcon className="size-3.5" /> Back to sign in
            </Link>
          }
        />
      </AuthShell>
    );
  }

  const isReset = data.purpose === "RESET";

  return (
    <AuthShell
      title={isReset ? "Reset your password" : "Set up your account"}
      description={isReset ? "Choose a new password for your account." : "Choose a password to finish setting up your account."}
    >
      <form className="flex flex-col gap-3" onSubmit={handleSubmit(onSubmit)}>
        {data.email && <p className="-mt-1 text-sm text-muted-foreground">Setting a password for {data.email}.</p>}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          <p className="text-xs text-muted-foreground">At least 10 characters, with a letter and a number.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...register("confirmPassword")} />
          {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
        </div>

        <Button type="submit" disabled={submitting} className="mt-1">
          {submitting && <Loader2Icon className="animate-spin" />}
          {isReset ? "Reset password" : "Set up account"}
        </Button>
      </form>
    </AuthShell>
  );
}

function SetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  if (!token) {
    return (
      <AuthShell title="Account access">
        <EmptyState
          icon={ShieldAlertIcon}
          title="This link can't be used"
          description="This link is missing its token. Please check the link or ask for a new one."
          action={
            <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <ArrowLeftIcon className="size-3.5" /> Back to sign in
            </Link>
          }
        />
      </AuthShell>
    );
  }

  return <SetPasswordForm token={token} />;
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<AuthShell title="Set up your account"><Skeleton className="h-32 w-full" /></AuthShell>}>
      <SetPasswordContent />
    </Suspense>
  );
}
