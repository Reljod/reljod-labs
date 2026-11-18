"use server";

import type {
  HandInput,
  ManifestSummary,
  ModelId,
  TaskRef,
} from "../domain/contract";
import type { Rulebook } from "../domain/rules";

/* Signatures only for now; the bodies land with the server. */
const TODO = { error: "Not available yet." };

/** Starts a Run the Operator drives. */
export async function startRun(_input: {
  task: TaskRef;
  manifestId?: string | null;
  model?: ModelId;
}): Promise<{ runId: string } | { error: string }> {
  return TODO;
}

/** Stops one of the Owner's Runs. Never asks first: it is the escape hatch. */
export async function stopRun(
  _runId: string,
): Promise<{ runId: string; stopped: boolean } | { error: string }> {
  return TODO;
}

/** A person's decision on a paused Action. */
export async function decideApproval(_input: {
  runId: string;
  approvalId: string;
  decision: "approved" | "refused";
}): Promise<{ ok: true } | { error: string }> {
  return TODO;
}

/** Saves the Rulebook as the Owner's next version. */
export async function saveRulebook(_input: {
  rulebook: Rulebook;
  note?: string;
}): Promise<{ version: number } | { error: string }> {
  return TODO;
}

/** Opens a Manifest upload: a row and a signed URL the browser PUTs the file to. */
export async function createManifestUpload(_input: {
  name: string;
  size: number;
}): Promise<
  | { manifestId: string; signedUrl: string; token: string; path: string }
  | { error: string }
> {
  return TODO;
}

/** Reads an uploaded Manifest (CSV or PDF) into rows. Call after the upload finished. */
export async function readManifest(
  _manifestId: string,
): Promise<ManifestSummary | { error: string }> {
  return TODO;
}

/** Files a "take the keyboard" attempt: the server replays the inputs and checks them. */
export async function submitHandRun(_input: {
  taskId: string;
  inputs: HandInput[];
  elapsedMs: number;
}): Promise<{ runId: string } | { error: string }> {
  return TODO;
}

/** A bearer token for an outside MCP client to act for this Owner. */
export async function mintMcpToken(): Promise<{
  token: string;
  expiresAt: string;
}> {
  return { token: "", expiresAt: new Date().toISOString() };
}
