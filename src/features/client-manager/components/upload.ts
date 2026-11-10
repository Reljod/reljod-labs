"use client";

export type FileMeta = { name: string; type: string; size: number };

export const metaOf = (file: File): FileMeta => ({
  name: file.name,
  type: file.type || "application/octet-stream",
  size: file.size,
});

/**
 * PUTs a file to a Supabase Storage signed upload URL, reporting progress.
 * XHR rather than fetch: fetch can't report upload progress.
 */
export function putFile(
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader(
      "content-type",
      file.type || "application/octet-stream",
    );
    request.setRequestHeader("x-upsert", "true");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(
            new Error(`Upload of ${file.name} failed (${request.status})`),
          );
    request.onerror = () => reject(new Error(`Upload of ${file.name} failed`));
    request.send(file);
  });
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

export const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.csv,.docx,.txt,.md,application/pdf,image/*";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
