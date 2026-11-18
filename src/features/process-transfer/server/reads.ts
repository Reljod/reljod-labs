import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import { AUDIT_PAGE } from "../domain/api";
import { spendView } from "../domain/caps";
import { LIMITS } from "../domain/limits";
import type { AuditEvent, DeskView, RunView } from "../domain/run";
import { sampleBySlug } from "../domain/samples";
import {
  listAuditEvents,
  listRuns,
  modelCalls,
  ownedRun,
  toRunView,
} from "./repository";
import { activeRun, visitorOf, workCounts } from "./runs";
import { ownerSettings } from "./settings";
import { signedUrl } from "./storage";

/*
 * The page's reads, each scoped to the Owner it is handed. The callers (the
 * page's server component and the GET routes under /api/process-transfer)
 * pass the Access gate first. Reads are not server actions on purpose: Next
 * sends actions one at a time per client, so a read made through one waits
 * behind every other action (and every write behind it).
 */

/** Everything the Desk opens with, read in one go. */
export async function readDesk(
  access: Access,
  owner: Owner,
): Promise<DeskView> {
  const visitor = await visitorOf(access);
  const [runs, settings, counts, running] = await Promise.all([
    listRuns(owner),
    ownerSettings(owner),
    workCounts(owner, visitor),
    activeRun(owner),
  ]);
  return {
    runs,
    rules: settings.rules,
    ruleOverrides: settings.ruleOverrides,
    rulesVersion: settings.rulesVersion,
    models: settings.models,
    spend: spendView(counts),
    activeRunId: running?.id ?? null,
    limits: {
      uploadBytes: LIMITS.uploadBytes,
      uploadSeconds: LIMITS.uploadSeconds,
    },
  };
}

/** One of the Owner's Runs, or null when the Owner has no such Run. */
export async function readRun(
  owner: Owner,
  runId: string,
): Promise<RunView | null> {
  const row = await ownedRun(owner, runId);
  if (!row) return null;
  const [calls, video] = await Promise.all([
    modelCalls(row.id),
    row.source_kind === "sample"
      ? (sampleBySlug(row.sample_slug ?? "")?.video ?? null)
      : row.recording_path
        ? signedUrlOrNull(row.recording_path)
        : null,
  ]);
  return toRunView(row, calls, video);
}

function signedUrlOrNull(path: string): Promise<string | null> {
  return signedUrl(path).catch(() => null);
}

/** A page of the Owner's Audit trail, newest first, optionally one Run's. */
export async function readAudit(
  owner: Owner,
  input: { before?: number; runId?: string },
): Promise<AuditEvent[]> {
  let runId: string | undefined;
  if (input.runId !== undefined) {
    const run = await ownedRun(owner, input.runId);
    if (!run) return [];
    runId = run.id;
  }
  return listAuditEvents(owner, {
    before: input.before,
    runId,
    limit: AUDIT_PAGE,
  });
}
