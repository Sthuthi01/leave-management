"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import type { LeaveRequestWithRelations } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { LeaveTypeBadge } from "@/components/leave/leave-type-badge";
import { CheckIcon, XIcon, Loader2Icon } from "lucide-react";
import { format, parseISO } from "date-fns";

export function DecisionDialog({ request }: { request: LeaveRequestWithRelations }) {
  const [open, setOpen] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [comment, setComment] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (decision: "APPROVED" | "REJECTED") => api.post(`/leave-requests/${request.id}/decide`, { decision, comment }),
    onSuccess: (_, decision) => {
      toast.success(decision === "APPROVED" ? "Leave request approved." : "Leave request rejected.");
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(null);
      setComment("");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not record your decision."),
  });

  return (
    <>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen("REJECTED")}>
          <XIcon /> Reject
        </Button>
        <Button size="sm" onClick={() => setOpen("APPROVED")}>
          <CheckIcon /> Approve
        </Button>
      </div>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{open === "APPROVED" ? "Approve" : "Reject"} leave request</DialogTitle>
            <DialogDescription>
              {request.employee.name} · <LeaveTypeBadge leaveType={request.leaveType} /> · {format(parseISO(request.startDate), "d MMM")} – {format(parseISO(request.endDate), "d MMM yyyy")} ({request.days} day{request.days === 1 ? "" : "s"})
            </DialogDescription>
          </DialogHeader>

          {request.reason && <p className="rounded-lg bg-muted p-2.5 text-sm text-muted-foreground">&ldquo;{request.reason}&rdquo;</p>}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="comment">Comment {open === "REJECTED" ? <span className="text-destructive">(required)</span> : "(optional)"}</Label>
            <Textarea
              id="comment"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={open === "REJECTED" ? "Let the employee know why this is being rejected..." : "Add a note for the employee..."}
            />
            {open === "REJECTED" && !comment.trim() && <p className="text-xs text-muted-foreground">A reason helps the employee understand and resubmit correctly.</p>}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant={open === "REJECTED" ? "destructive" : "default"}
              disabled={mutation.isPending || (open === "REJECTED" && !comment.trim())}
              onClick={() => open && mutation.mutate(open)}
            >
              {mutation.isPending && <Loader2Icon className="animate-spin" />}
              Confirm {open === "APPROVED" ? "approval" : "rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
