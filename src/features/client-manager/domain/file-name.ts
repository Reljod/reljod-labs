import type { SourceKind } from "./events";

/**
 * The extension of an uploaded file's name, safe to put in a storage path:
 * lower case, letters and digits only, at most eight characters. Names come
 * from the browser, so anything else (slashes, dots, nothing at all) falls
 * back.
 */
export function safeExtension(name: string, fallback: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return fallback;
  const extension = name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return extension || fallback;
}

export const ACCEPTED = {
  pdf: ["application/pdf"],
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  sheet: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
  ],
  doc: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  text: ["text/plain", "text/markdown"],
} as const;

/** What kind of Source a file is, from its type and then its extension. */
export function kindOf(name: string, mediaType: string): SourceKind | null {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (mediaType === "application/pdf" || extension === "pdf") return "pdf";
  if (
    mediaType.startsWith("image/") &&
    ["jpg", "jpeg", "png", "webp", "gif"].includes(extension)
  ) {
    return "image";
  }
  if (["xlsx", "csv"].includes(extension)) return "sheet";
  if (extension === "docx") return "doc";
  if (["txt", "md", "markdown", "eml"].includes(extension)) return "text";
  return null;
}

export function mediaTypeFor(kind: SourceKind, name: string, given: string) {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (kind === "pdf") return "application/pdf";
  if (kind === "image") {
    return given.startsWith("image/")
      ? given
      : extension === "png"
        ? "image/png"
        : "image/jpeg";
  }
  if (kind === "sheet")
    return extension === "csv" ? "text/csv" : ACCEPTED.sheet[0];
  if (kind === "doc") return ACCEPTED.doc[0];
  return "text/plain";
}

const UPLOADED_PORTRAIT =
  /^clients\/([0-9a-f-]{36})\/portrait-uploaded-\d{13}\.[a-z0-9]{1,8}$/;

/**
 * Whether a path the browser sends back is exactly what the upload step
 * handed out for this client: `clients/<id>/portrait-uploaded-<ms>.<ext>`,
 * with nothing else before, after or in between.
 */
export function isUploadedPortraitPath(clientId: string, path: string) {
  const match = UPLOADED_PORTRAIT.exec(path);
  return !!match && match[1] === clientId.toLowerCase();
}
