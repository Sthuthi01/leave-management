import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { logAudit } from "@/lib/db/repo";
import { deleteResourceDocument, getResource, getResourceDocumentData, setResourceDocument } from "@/lib/db/onboarding-repo";
import { resourceVisibleToEmployee } from "@/lib/onboarding";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/png",
  "image/jpeg",
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can upload onboarding documents.");

  const { id } = await params;
  const resource = await getResource(id);
  if (!resource) return errorResponse(404, "Resource not found.");

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) return errorResponse(400, "No file was uploaded.");
  if (file.size === 0) return errorResponse(400, "The uploaded file is empty.");
  if (file.size > MAX_FILE_BYTES) return errorResponse(400, "Files must be 10MB or smaller.");
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return errorResponse(400, "Unsupported file type. Upload a PDF, Word, PowerPoint, Excel, text, or image file.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const document = await setResourceDocument(id, {
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
    dataBase64: buffer.toString("base64"),
  });
  await logAudit(user, "Uploaded onboarding resource document", "OnboardingResource", `${resource.title} (${document.fileName})`);

  return NextResponse.json(document, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can remove onboarding documents.");

  const { id } = await params;
  const resource = await getResource(id);
  if (!resource) return errorResponse(404, "Resource not found.");

  await deleteResourceDocument(id);
  await logAudit(user, "Removed onboarding resource document", "OnboardingResource", resource.title);
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  const { id } = await params;
  const resource = await getResource(id);
  if (!resource) return errorResponse(404, "Resource not found.");
  if (user.role !== "ADMIN" && !resourceVisibleToEmployee(resource, user)) {
    return errorResponse(403, "This resource isn't available to you.");
  }

  const document = await getResourceDocumentData(id);
  if (!document) return errorResponse(404, "This resource has no document.");

  const bytes = Buffer.from(document.dataBase64, "base64");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `inline; filename="${document.fileName.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
