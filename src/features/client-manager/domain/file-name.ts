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
