import { FileTextIcon, ExternalLinkIcon, BookOpenIcon, type LucideIcon } from "lucide-react";
import type { OnboardingResource } from "@/types";

export type ResourceContentKind = "DOCUMENT" | "LINK" | "TEXT";

interface ContentTypeMeta {
  icon: LucideIcon;
  label: string;
  /** What clicking through to this resource lets the employee do — shown as the card/row's call to action. */
  action: string;
}

const CONTENT_TYPE_META: Record<ResourceContentKind, ContentTypeMeta> = {
  DOCUMENT: { icon: FileTextIcon, label: "Document", action: "View & download" },
  LINK: { icon: ExternalLinkIcon, label: "External link", action: "Open link" },
  TEXT: { icon: BookOpenIcon, label: "Written guide", action: "Read guide" },
};

/** A resource's primary content, in the same priority order the admin form and detail dialog already use. */
export function resourceContentKind(resource: Pick<OnboardingResource, "document" | "url">): ResourceContentKind {
  if (resource.document) return "DOCUMENT";
  if (resource.url) return "LINK";
  return "TEXT";
}

export function resourceContentTypeMeta(resource: Pick<OnboardingResource, "document" | "url">): ContentTypeMeta {
  return CONTENT_TYPE_META[resourceContentKind(resource)];
}
