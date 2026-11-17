"use client";

import type { ExportKind } from "../domain/run";
import { fileSlug } from "./format";

export const EXPORT_MIME: Record<ExportKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** "month-end-contribution-reconciliation.pptx": the Process title, made safe. */
export function exportName(title: string, kind: ExportKind): string {
  return `${fileSlug(title)}.${kind}`;
}

/** Hands the browser a file to save. The object URL is freed once the click has been taken. */
export function saveFile(bytes: Uint8Array, name: string, kind: ExportKind) {
  const blob = new Blob([bytes as BlobPart], { type: EXPORT_MIME[kind] });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
