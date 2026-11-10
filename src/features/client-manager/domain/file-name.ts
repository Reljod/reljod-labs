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
