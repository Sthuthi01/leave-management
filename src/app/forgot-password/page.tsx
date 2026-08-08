"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2Icon, MailCheckIcon, ArrowLeftIcon } from "lucide-react";

const schema = z.object({ email: z.string().trim().email("Enter a valid email.") });
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  async function onSubmit(values: FormValues) {
    try {
      // The endpoint always returns success, whether or not the email has an account — it never
      // reveals which emails are registered, so we only branch to the error state on a genuine
      // request failure (bad connection, server error), not on "no such account".
      await api.post("/auth/forgot-password", values);
      setSent(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <MailCheckIcon className="size-8 text-primary" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">
            If an account exists for that email, we&apos;ve sent a link to reset your password. It expires in 1 hour.
          </p>
          <Link href="/login" className="mt-2 flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <ArrowLeftIcon className="size-3.5" /> Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password?" description="Enter your email and we'll send you a link to reset it.">
      <form className="flex flex-col gap-3" onSubmit={handleSubmit(onSubmit)}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <Button type="submit" disabled={isSubmitting} className="mt-1">
          {isSubmitting && <Loader2Icon className="animate-spin" />}
          Send reset link
        </Button>

        <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline">
          <ArrowLeftIcon className="size-3.5" /> Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}
