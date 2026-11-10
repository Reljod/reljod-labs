"use client";

import { beginUpload, finishUpload, type UploadSlot } from "../server/actions";
import type { DocView } from "../view";

const MAX_PAGES = 12;
const ACCEPTED = /\.(pdf|jpe?g|png|csv)$/i;

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (file: File) => void, fail: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      ok: (entries: FileSystemEntryLike[]) => void,
      fail: (error: unknown) => void,
    ) => void;
  };
};

async function walk(entry: FileSystemEntryLike, into: File[]) {
  if (into.length >= 60) return;
  if (entry.isFile && entry.file) {
    const read = entry.file.bind(entry);
    const file = await new Promise<File | null>((resolve) =>
      read(resolve, () => resolve(null)),
    );
    if (file && !file.name.startsWith(".")) into.push(file);
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  const reader = entry.createReader();
  // readEntries hands back a folder in batches until it returns none.
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    );
    if (batch.length === 0) break;
    for (const child of batch) await walk(child, into);
  }
}

/** Every file in a drop, walking into any folders that were dropped. */
export async function filesFromDrop(data: DataTransfer): Promise<File[]> {
  const entries = [...data.items].flatMap((item) => {
    if (item.kind !== "file") return [];
    const entry = (
      item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryLike | null;
      }
    ).webkitGetAsEntry?.();
    return entry ? [entry] : [];
  });
  // Entries must be taken before the first await; the list empties after it.
  const flat = [...data.files];
  if (entries.length === 0) return flat;
  const files: File[] = [];
  for (const entry of entries) await walk(entry, files);
  return files;
}

export function hasFiles(data: DataTransfer | null) {
  return Boolean(data?.types.includes("Files"));
}

/** Renders a PDF's pages to JPEG (the jobs read pages as images) and says whether it has a text layer. */
async function renderPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  // The worker matches the installed pdf.js exactly; bundling it would make it an external server package.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const pages: Blob[] = [];
  let text = 0;
  for (let number = 1; number <= Math.min(pdf.numPages, MAX_PAGES); number++) {
    const page = await pdf.getPage(number);
    text += (await page.getTextContent()).items.length;
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) continue;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (blob) pages.push(blob);
  }
  await pdf.cleanup();
  return { pages, digital: text > 20 };
}

async function put(url: string, body: Blob, contentType: string) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": contentType, "x-upsert": "true" },
    body,
  });
  if (!response.ok) throw new Error(`Storage said ${response.status}`);
}

export type UploadReport = {
  created: DocView[];
  /** Files that were left out, each with why. */
  skipped: { name: string; reason: string }[];
};

/**
 * Uploads dropped files straight to Storage, one at a time so progress can
 * be shown, then records them as Documents of this desk.
 */
export async function uploadFiles(
  files: File[],
  onProgress: (done: number, total: number, name: string) => void,
): Promise<UploadReport> {
  const skipped: UploadReport["skipped"] = [];
  const wanted = files.filter((file) => {
    if (ACCEPTED.test(file.name)) return true;
    skipped.push({ name: file.name, reason: "only PDF, JPEG, PNG or CSV" });
    return false;
  });
  const tickets: string[] = [];
  for (const [index, file] of wanted.entries()) {
    onProgress(index, wanted.length, file.name);
    try {
      const isPdf = /\.pdf$/i.test(file.name);
      const rendered = isPdf
        ? await renderPdf(file)
        : { pages: [], digital: false };
      const [slot] = (await beginUpload([
        {
          name: file.name,
          type: file.type,
          size: file.size,
          pages: rendered.pages.length,
          digital: rendered.digital,
        },
      ])) as UploadSlot[];
      if (!slot?.ok) {
        skipped.push({
          name: file.name,
          reason: slot?.reason ?? "refused",
        });
        continue;
      }
      await put(slot.fileUrl, file, slot.contentType);
      await Promise.all(
        slot.pageUrls.map((url, page) => {
          const blob = rendered.pages[page];
          return blob ? put(url, blob, "image/jpeg") : undefined;
        }),
      );
      tickets.push(slot.ticket);
    } catch (error) {
      skipped.push({
        name: file.name,
        reason: error instanceof Error ? error.message : "upload failed",
      });
    }
  }
  onProgress(wanted.length, wanted.length, "");
  const created = tickets.length > 0 ? await finishUpload(tickets) : [];
  return { created, skipped };
}
