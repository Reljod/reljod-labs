"use client";

import type { ManifestSummary } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { api } from "./api";
import { bytes } from "./format";

export type ManifestStage = "uploading" | "reading";

const TYPES: Record<string, string> = {
  csv: "text/csv",
  pdf: "application/pdf",
};

/** Why a file cannot be a Manifest, or null. The server checks again. */
export function manifestProblem(file: { name: string; size: number }) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(extension in TYPES)) return "A Manifest is a CSV or a PDF file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > LIMITS.manifestBytes)
    return `That file is ${bytes(file.size)}. A Manifest may be up to ${bytes(LIMITS.manifestBytes)}.`;
  return null;
}

/**
 * Attaches a Manifest: asks the server for an upload slot, PUTs the file to
 * the signed Storage URL, then has the server read it into rows.
 */
export async function uploadManifest(
  file: File,
  onStage: (stage: ManifestStage) => void,
): Promise<ManifestSummary> {
  const problem = manifestProblem(file);
  if (problem) throw new Error(problem);
  onStage("uploading");
  const slot = await api.openManifestUpload({
    name: file.name,
    size: file.size,
  });
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const response = await fetch(slot.signedUrl, {
    method: "PUT",
    headers: { "content-type": file.type || TYPES[extension] },
    body: file,
  });
  if (!response.ok) throw new Error(`Storage said ${response.status}.`);
  onStage("reading");
  return api.readManifest(slot.manifestId);
}
