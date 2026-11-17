import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type {
  SourceIngestResponse,
  SourceResponse,
  SourceUploadUrlResponse,
} from "../domain/api";
import type {
  ConflictView,
  PassageHit,
  Resolution,
  SourceView,
} from "../domain/knowledge";
import type { Actor, PaidActor } from "./actor";
import { NotBuiltError } from "./errors";

/*
 * STUB. Owned by the Knowledge slice, which replaces every body here and
 * keeps the signatures (ADR 0016). The routes under `/api/harness/sources`,
 * `/search` and `/conflicts`, the Knowledge tab, the chat and the MCP
 * server's search and ingest tools call these.
 */

/**
 * Searches the Workspace's Passages by words and meaning
 * (`harness.search_passages`, reciprocal rank fusion). Superseded Passages
 * are left out; a hit under an open Conflict says so (`conflictOpen`).
 */
export async function searchKnowledge(
  _owner: Owner,
  _query: string,
  _limit = 8,
): Promise<PassageHit[]> {
  throw new NotBuiltError("knowledge");
}

/** The Workspace's Sources, newest first, seed Sources after. */
export async function listSources(_owner: Owner): Promise<SourceView[]> {
  throw new NotBuiltError("knowledge");
}

/**
 * Registers an upload as a `pending` Source and returns a signed URL the
 * browser PUTs the file to (the private `harness` bucket).
 *
 * Must: check `can(staff, "source.add")`; hold `bytes` to
 * `LIMITS.uploadBytes` and the Workspace to `LIMITS.sourcesPerWorkspace`;
 * take one of the visitor's `LIMITS.sourcesPerHour`; build the storage key
 * under `owners/<owner>/sources/<sourceId>/` from `safeExtension` and
 * `slugify` only, never from the raw name (conventions.md); write
 * `file.uploaded`.
 */
export async function createUpload(
  _input: PaidActor & {
    name: string;
    type: string;
    bytes: number;
    sessionId?: string | null;
  },
): Promise<SourceUploadUrlResponse> {
  throw new NotBuiltError("knowledge");
}

/**
 * Adds a Source from text the caller already has (a pasted note, a web page
 * the Agent fetched, an MCP client's document) and reads it at once, as
 * `ingestSource` does. Same checks and limits as `createUpload`.
 */
export async function addTextSource(
  _input: PaidActor & {
    title: string;
    text: string;
    kind?: "text" | "web";
    /** `YYYY-MM-DD`: the date the document itself carries. */
    documentDate?: string | null;
    sessionId?: string | null;
  },
): Promise<SourceIngestResponse> {
  throw new NotBuiltError("knowledge");
}

/**
 * Reads an uploaded Source into Passages, embeds them, and checks the new
 * Passages against the old ones for Conflicts.
 *
 * Must: hold the Source to the Owner; claim it (`pending` → `reading`) so
 * two calls read it once; cap Passages at `LIMITS.passagesPerSource` and the
 * Conflict check at `LIMITS.passagesCheckedPerSource`; write `source.added`,
 * and `conflict.found` for each Conflict. Nothing is superseded here: a
 * person settles a Conflict.
 */
export async function ingestSource(
  _input: PaidActor & { sourceId: string },
): Promise<SourceIngestResponse> {
  throw new NotBuiltError("knowledge");
}

/** Removes a Source that is not a seed, with its Passages and Conflicts and its file. Checks `can(staff, "source.remove")` and writes `source.removed`. */
export async function removeSource(
  _input: Actor & { sourceId: string },
): Promise<void> {
  throw new NotBuiltError("knowledge");
}

/** The Workspace's Conflicts, open first, then newest. */
export async function listConflicts(
  _owner: Owner,
  _filter: { status?: "open" | "resolved" | null } = {},
): Promise<ConflictView[]> {
  throw new NotBuiltError("knowledge");
}

/**
 * A person settles a Conflict: the new Passage supersedes the old one, both
 * stay, or the new one is set aside (it is marked superseded by the old).
 *
 * Must: check `can(staff, "conflict.resolve")`; refuse with a StateError
 * unless it is still `open` (claim it in the update); mark the superseded
 * Passage and write `conflict.resolved` in the same transaction (`auditIn`).
 */
export async function resolveConflict(
  _input: Actor & { conflictId: string; resolution: Resolution },
): Promise<ConflictView> {
  throw new NotBuiltError("knowledge");
}

/** A Source with its Passages in order (superseded ones marked), or null when it is not in the Workspace. */
export async function readSource(
  _owner: Owner,
  _sourceId: string,
): Promise<SourceResponse | null> {
  throw new NotBuiltError("knowledge");
}
