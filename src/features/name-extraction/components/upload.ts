"use client";

import { createUpload } from "../server/actions";

/** The longest Document Sieve takes. The server checks it again. */
export const MAX_PAGES = 500;

export type UploadProgress =
  | { stage: "reading"; done: number; total: number }
  | { stage: "uploading" }
  | { stage: "done" };

/** One page's text from pdf.js items, keeping line breaks where the PDF has them. */
function pageText(items: unknown[]) {
  let text = "";
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const { str, hasEOL } = item as { str: string; hasEOL?: boolean };
    text += str;
    text += hasEOL ? "\n" : str.endsWith(" ") || str === "" ? "" : " ";
  }
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * Reads a PDF's text layer in the browser, page by page, with pdf.js. Only
 * text leaves the browser; a scanned PDF with no text layer is refused here.
 */
export async function readPdfText(
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  // The worker matches the installed pdf.js exactly (as Casework loads it).
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PAGES)
      throw new Error(
        `This PDF has ${pdf.numPages} pages; Sieve reads up to ${MAX_PAGES}.`,
      );
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      onProgress({ stage: "reading", done: number - 1, total: pdf.numPages });
      const page = await pdf.getPage(number);
      pages.push(pageText((await page.getTextContent()).items));
      page.cleanup();
    }
    const characters = pages.reduce((sum, page) => sum + page.length, 0);
    if (characters < 20 * pages.length)
      throw new Error(
        "This PDF has almost no text layer (a scan?). Sieve reads text, not images.",
      );
    return pages;
  } finally {
    await task.destroy();
  }
}

/**
 * Reads the PDF's text, asks the server for an upload slot, and PUTs the
 * pages as JSON to the signed Storage URL. Resolves to the upload's id for
 * `startRun({ source: { kind: "upload", uploadId } })`.
 */
export async function uploadPdf(
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<string> {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf")
    throw new Error("Only PDF files.");
  const pages = await readPdfText(file, onProgress);
  onProgress({ stage: "uploading" });
  const title = file.name.replace(/\.pdf$/i, "").slice(0, 120) || "Upload";
  const slot = await createUpload({ title, pages: pages.length });
  if ("error" in slot) throw new Error(slot.error);
  const response = await fetch(slot.signedUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pages }),
  });
  if (!response.ok) throw new Error(`Storage said ${response.status}.`);
  onProgress({ stage: "done" });
  return slot.uploadId;
}
