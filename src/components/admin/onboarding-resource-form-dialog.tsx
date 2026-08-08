"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, Controller, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { ROLE_OPTIONS } from "@/lib/rbac";
import type { Department, OnboardingResource, ResourceCategory } from "@/types";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Loader2Icon, PlusIcon, Trash2Icon, FileTextIcon, UploadIcon } from "lucide-react";

const ACCEPTED_DOCUMENT_TYPES = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg";

const CATEGORY_OPTIONS: { value: ResourceCategory; label: string }[] = [
  { value: "GUIDE", label: "Guide" },
  { value: "POLICY", label: "Policy" },
  { value: "TRAINING", label: "Training material" },
];

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
] as const;

const AUDIENCE_OPTIONS = [
  { value: "ALL", label: "Everyone" },
  { value: "DEPARTMENT", label: "One department" },
  { value: "ROLE", label: "One role" },
] as const;

export const RESOURCE_STATUS_TOOLTIP = "Draft resources are hidden from employees until switched to Published.";
export const RESOURCE_AUDIENCE_TOOLTIP = "Who can see this resource — everyone, one department, or one role.";

const schema = z
  .object({
    title: z.string().trim().min(2, "Title is required."),
    category: z.enum(["GUIDE", "POLICY", "TRAINING"]),
    status: z.enum(["DRAFT", "PUBLISHED"]),
    isRequired: z.boolean(),
    audienceScope: z.enum(["ALL", "DEPARTMENT", "ROLE"]),
    audienceDepartmentId: z.string(),
    audienceRole: z.string(),
    effectiveDate: z.string(),
    description: z.string().trim().min(3, "Add a short one-line summary."),
    content: z.string().trim(),
    url: z.string().trim().url("Enter a valid URL.").optional().or(z.literal("")),
    attachments: z.array(z.object({ name: z.string(), url: z.string() })),
  })
  .superRefine((values, ctx) => {
    if (values.audienceScope === "DEPARTMENT" && !values.audienceDepartmentId) {
      ctx.addIssue({ code: "custom", path: ["audienceDepartmentId"], message: "Select a department." });
    }
    if (values.audienceScope === "ROLE" && !values.audienceRole) {
      ctx.addIssue({ code: "custom", path: ["audienceRole"], message: "Select a role." });
    }
  });

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = {
  title: "",
  category: "GUIDE",
  status: "DRAFT",
  isRequired: false,
  audienceScope: "ALL",
  audienceDepartmentId: "",
  audienceRole: "",
  effectiveDate: "",
  description: "",
  content: "",
  url: "",
  attachments: [],
};

export function OnboardingResourceFormDialog({
  open,
  onOpenChange,
  resource,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: OnboardingResource | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(resource);
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: () => api.get<Department[]>("/departments") });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const { fields, append, remove } = useFieldArray({ control, name: "attachments" });
  const audienceScope = useWatch({ control, name: "audienceScope" });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [removeDocument, setRemoveDocument] = useState(false);
  const existingDocument = resource?.document ?? null;

  // Reset the (non-form-managed) file selection whenever the dialog transitions to open — done
  // during render, React's sanctioned pattern for this, rather than as a setState-in-effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDocumentFile(null);
      setRemoveDocument(false);
    }
  }

  useEffect(() => {
    if (open) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      reset(
        resource
          ? {
              title: resource.title,
              category: resource.category,
              status: resource.status,
              isRequired: resource.isRequired,
              audienceScope: resource.audienceScope,
              audienceDepartmentId: resource.audienceDepartmentId ?? "",
              audienceRole: resource.audienceRole ?? "",
              effectiveDate: resource.effectiveDate ?? "",
              description: resource.description,
              content: resource.content ?? "",
              url: resource.url ?? "",
              attachments: resource.attachments.map((a) => ({ name: a.name, url: a.url })),
            }
          : EMPTY
      );
    }
  }, [open, resource, reset]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        ...values,
        content: values.content.trim() || null,
        url: values.url || null,
        audienceDepartmentId: values.audienceScope === "DEPARTMENT" ? values.audienceDepartmentId : null,
        audienceRole: values.audienceScope === "ROLE" ? values.audienceRole : null,
        effectiveDate: values.effectiveDate || null,
        attachments: values.attachments.filter((a) => a.name.trim() && a.url.trim()),
      };
      const saved = isEdit
        ? await api.patch<OnboardingResource>(`/onboarding/resources/${resource!.id}`, payload)
        : await api.post<OnboardingResource>("/onboarding/resources", payload);

      if (documentFile) {
        const formData = new FormData();
        formData.append("file", documentFile);
        await api.upload(`/onboarding/resources/${saved.id}/document`, formData);
      } else if (removeDocument && existingDocument) {
        await api.delete(`/onboarding/resources/${saved.id}/document`);
      }
      return saved;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Resource updated." : "Resource added.");
      queryClient.invalidateQueries({ queryKey: ["onboarding-resources"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit resource" : "Add resource"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this guide, policy, or training material." : "Add a guide, policy, or training material to the resource library."}
          </DialogDescription>
        </DialogHeader>

        <form className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="res-title">Title</Label>
              <Input id="res-title" placeholder="e.g. Employee Handbook" {...register("title")} />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="res-category">Category</Label>
              <Controller
                name="category"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} items={CATEGORY_OPTIONS}>
                    <SelectTrigger id="res-category" className="w-full sm:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="res-status">
                Status
                <InfoTooltip text={RESOURCE_STATUS_TOOLTIP} />
              </Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} items={STATUS_OPTIONS}>
                    <SelectTrigger id="res-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="res-effective">
                Effective date <span className="font-normal text-muted-foreground">(optional)</span>
                <InfoTooltip text="When this resource becomes visible to its audience. Leave blank to publish immediately." />
              </Label>
              <Input id="res-effective" type="date" {...register("effectiveDate")} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Required</p>
              <p className="text-xs text-muted-foreground">Employees must review this as part of onboarding.</p>
            </div>
            <Controller name="isRequired" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
          </div>

          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="res-audience-scope">
                Audience
                <InfoTooltip text={RESOURCE_AUDIENCE_TOOLTIP} />
              </Label>
              <Controller
                name="audienceScope"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} items={AUDIENCE_OPTIONS}>
                    <SelectTrigger id="res-audience-scope" className="w-full sm:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUDIENCE_OPTIONS.map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            {audienceScope === "DEPARTMENT" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="res-audience-department">Department</Label>
                <Controller
                  name="audienceDepartmentId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} items={(departments ?? []).map((d) => ({ value: d.id, label: d.name }))}>
                      <SelectTrigger id="res-audience-department" className="w-full">
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {(departments ?? []).map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.audienceDepartmentId && <p className="text-xs text-destructive">{errors.audienceDepartmentId.message}</p>}
              </div>
            )}
            {audienceScope === "ROLE" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="res-audience-role">Role</Label>
                <Controller
                  name="audienceRole"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} items={ROLE_OPTIONS}>
                      <SelectTrigger id="res-audience-role" className="w-full">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.audienceRole && <p className="text-xs text-destructive">{errors.audienceRole.message}</p>}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="res-description">Short description</Label>
            <Input id="res-description" placeholder="One line shown in the library list" {...register("description")} />
            {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Document</Label>
            <p className="text-xs text-muted-foreground">
              Upload a PDF, Word, PowerPoint, Excel, text, or image file — the primary way to give employees this resource&apos;s content.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={ACCEPTED_DOCUMENT_TYPES}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setDocumentFile(file);
                if (file) setRemoveDocument(false);
              }}
            />
            {existingDocument && !removeDocument && !documentFile ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <a
                  href={`/api/onboarding/resources/${resource!.id}/document`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1.5 font-medium text-primary hover:underline"
                >
                  <FileTextIcon className="size-4 shrink-0" />
                  <span className="truncate">{existingDocument.fileName}</span>
                </a>
                <div className="flex shrink-0 gap-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    Replace
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove document" onClick={() => setRemoveDocument(true)}>
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            ) : documentFile ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  <FileTextIcon className="size-4 shrink-0" />
                  <span className="truncate">{documentFile.name}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove selected file"
                  onClick={() => {
                    setDocumentFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-fit" onClick={() => fileInputRef.current?.click()}>
                <UploadIcon /> Upload document
              </Button>
            )}
            {existingDocument && removeDocument && !documentFile && (
              <p className="text-xs text-muted-foreground">
                The current document will be removed when you save.{" "}
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => setRemoveDocument(false)}>
                  Undo
                </button>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="res-url">
              External link <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="res-url" placeholder="https://..." {...register("url")} />
            {errors.url && <p className="text-xs text-destructive">{errors.url.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="res-content">
              Content <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id="res-content" rows={4} placeholder="Optional rich text shown alongside the document or link." {...register("content")} />
            {errors.content && <p className="text-xs text-destructive">{errors.content.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label>
                Attachments <span className="font-normal text-muted-foreground">(optional)</span>
                <InfoTooltip text="Extra files or links shown alongside the main document." />
              </Label>
              <Button type="button" variant="outline" size="sm" onClick={() => append({ name: "", url: "" })}>
                <PlusIcon /> Add attachment
              </Button>
            </div>
            {fields.length > 0 && (
              <div className="flex flex-col gap-2">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex items-center gap-2">
                    <Input placeholder="Attachment name" {...register(`attachments.${index}.name`)} />
                    <Input placeholder="https://..." {...register(`attachments.${index}.url`)} />
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove attachment" onClick={() => remove(index)}>
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" />}
              {isEdit ? "Save changes" : "Add resource"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
