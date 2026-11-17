import "server-only";
import { after } from "next/server";
import type { Owner } from "@/features/access/domain/owner";
import type {
  SourceIngestResponse,
  SourceResponse,
  SourceUploadUrlResponse,
} from "../domain/api";
import type { AuditUsage } from "../domain/audit";
import {
  type ConflictView,
  type PassageHit,
  RESOLUTIONS,
  type Resolution,
  type SourceKind,
  type SourceView,
} from "../domain/knowledge";
import { planResolution } from "../domain/knowledge/conflicts";
import { findDocumentDate } from "../domain/knowledge/dates";
import {
  type FileKind,
  kindOf,
  sourceStorageKey,
  titleFromName,
} from "../domain/knowledge/file-kind";
import {
  embeddingText,
  MAX_TEXT_CHARS,
  splitSource,
} from "../domain/knowledge/split";
import { LIMITS } from "../domain/limits";
import type { Actor, PaidActor } from "./actor";
import { audit, auditIn } from "./audit";
import { assertCan } from "./context";
import { type Db, isUuid, sql } from "./db";
import { InvalidError, LimitError, NotFoundError, StateError } from "./errors";
import { checkForConflicts } from "./knowledge/conflict-check";
import {
  embedAll,
  hasUnembedded,
  setEmbeddingsByOrdinal,
  shouldTryBackfill,
} from "./knowledge/embeddings";
import { extractText, UnreadableError } from "./knowledge/extract";
import { download, removeFile, uploadUrl } from "./knowledge/storage";
import {
  type HitRow,
  hitOf,
  loadConflicts,
  loadPassages,
  loadSource,
  loadSources,
  STALE_READING_MINUTES,
} from "./knowledge/views";
import { embed, toVector } from "./llm";
import { takeRate } from "./rate";
import { backfillKnowledge } from "./seed/knowledge";
import { writableSession } from "./sessions";
import { modelStubbed } from "./stub";

/*
 * The Knowledge base (ADR 0016): Sources, the Passages search finds, and
 * Conflicts. Every function takes the Owner and scopes by it; every write
 * checks the Role and writes an Audit event.
 */

/** Reads of one Source that may be tried before it stays failed (each costs model calls). */
const MAX_READS = 3;
/** No Conflict check starts after this long into one ingest, so the route's limit is kept. */
const INGEST_BUDGET_MS = 40_000;
const QUERY_CHARS = 500;
const TEXT_MIN_CHARS = 20;

const staffActor = (actor: Actor) => ({
  kind: "staff" as const,
  staff: actor.staff,
});

// Search --------------------------------------------------------------------------

const queryVectors = new Map<string, number[]>();

async function queryVector(query: string): Promise<number[] | null> {
  const cached = queryVectors.get(query);
  if (cached) return cached;
  try {
    const { embeddings } = await embed([query]);
    const vector = embeddings[0];
    if (!vector) return null;
    if (queryVectors.size >= 100) queryVectors.clear();
    queryVectors.set(query, vector);
    return vector;
  } catch (error) {
    // No gateway key or the gateway is down: search by words alone.
    console.error("[harness] could not embed a search query", error);
    return null;
  }
}

/** Embeds Passages that lack an embedding, after the response, at most once in a while per Owner. */
async function backfillSoon(owner: Owner) {
  if (!shouldTryBackfill(owner)) return;
  if (!(await hasUnembedded(owner))) return;
  const run = () =>
    backfillKnowledge(owner).catch((error) => {
      console.error("[harness] could not embed Passages", error);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Searches the Workspace's Passages by words and meaning
 * (`harness.search_passages`, reciprocal rank fusion). Superseded Passages
 * are left out; a hit under an open Conflict says so (`conflictOpen`). With
 * no embedding for the query (no gateway key) it searches by words alone.
 */
export async function searchKnowledge(
  owner: Owner,
  query: string,
  limit = 8,
): Promise<PassageHit[]> {
  const text = query.replace(/\s+/g, " ").trim().slice(0, QUERY_CHARS);
  if (!text) return [];
  const count = Math.max(1, Math.min(Math.trunc(limit) || 8, 25));
  const embedding = await queryVector(text);
  const rows = await sql()<HitRow[]>`
    select * from harness.search_passages(
      ${owner}, ${text}, ${embedding ? toVector(embedding) : null}::extensions.vector, ${count})`;
  await backfillSoon(owner).catch(() => {});
  return rows.map(hitOf);
}

// Reading --------------------------------------------------------------------------

/**
 * A Source whose read died (the function stopped) is failed so it can be
 * tried again, and the Workspace never holds one stuck in `reading`.
 */
async function clearStale(owner: Owner) {
  await sql()`
    update harness.sources
    set status = 'failed', error = 'Reading was interrupted. Try again.'
    where owner = ${owner} and status = 'reading' and not is_seed
      and reading_at < now() - make_interval(mins => ${STALE_READING_MINUTES + 2})`;
}

/**
 * The Workspace's Sources, newest first, seed Sources after. `filedOnly`
 * leaves out the attached-but-unfiled (`pending`) ones, which are not in the
 * Knowledge base yet.
 */
export async function listSources(
  owner: Owner,
  options: { filedOnly?: boolean } = {},
): Promise<SourceView[]> {
  await clearStale(owner);
  const sources = await loadSources(sql(), owner);
  return options.filedOnly
    ? sources.filter((source) => source.status !== "pending")
    : sources;
}

/** A Source with its Passages in order (superseded ones marked), or null when it is not in the Workspace. */
export async function readSource(
  owner: Owner,
  sourceId: string,
): Promise<SourceResponse | null> {
  if (!isUuid(sourceId)) return null;
  await clearStale(owner);
  const source = await loadSource(sql(), owner, sourceId);
  if (!source) return null;
  return { source, passages: await loadPassages(sql(), owner, sourceId) };
}

type TextRow = {
  id: string;
  title: string;
  kind: SourceKind;
  storage_path: string | null;
  extracted_text: string | null;
};

/** The text of a Source: cached, or read from its file and cached. */
async function textOf(owner: Owner, row: TextRow): Promise<string> {
  if (row.extracted_text) return row.extracted_text;
  if (!row.storage_path) {
    throw new UnreadableError("This Source has no file and no text.");
  }
  let bytes: Uint8Array;
  try {
    bytes = await download(row.storage_path);
  } catch {
    throw new UnreadableError(
      "The file never arrived. Upload it again, or use a sample.",
    );
  }
  if (bytes.byteLength > LIMITS.uploadBytes) {
    throw new UnreadableError("This file is larger than the upload limit.");
  }
  const text = await extractText(row.kind, bytes);
  await sql()`
    update harness.sources set extracted_text = ${text}
    where id = ${row.id} and owner = ${owner}`;
  return text;
}

/**
 * A Source and its text, read from the file on demand and cached, for a
 * caller that needs the words and not the Passages: a Pipeline reading a case
 * paper. Works for a Source that was never filed (`pending`). Null when it is
 * not in the Workspace; an InvalidError says why a file cannot be read.
 */
export async function readSourceText(
  owner: Owner,
  sourceId: string,
): Promise<{ source: SourceView; text: string } | null> {
  if (!isUuid(sourceId)) return null;
  const [row] = await sql()<TextRow[]>`
    select id, title, kind, storage_path, extracted_text
    from harness.sources where id = ${sourceId} and owner = ${owner}`;
  if (!row) return null;
  const cached = row.extracted_text !== null;
  let text: string;
  try {
    text = await textOf(owner, row);
  } catch (error) {
    if (error instanceof UnreadableError) throw new InvalidError(error.message);
    throw error;
  }
  const source = await loadSource(sql(), owner, sourceId);
  if (!source) return null;
  if (!cached) {
    await audit({
      owner,
      actor: { kind: "system" },
      action: "source.read",
      summary: `Read ${source.title}`,
      target: { kind: "source", id: source.id },
      detail: { kind: source.kind, chars: text.length },
    });
  }
  return { source, text };
}

// Adding ---------------------------------------------------------------------------

type NewSource = {
  id: string;
  title: string;
  kind: SourceKind;
  bytes: number;
  storagePath: string | null;
  text: string | null;
  documentDate: string | null;
  sessionId: string | null;
};

/** The checks and the row common to an upload and a text Source. */
async function registerSource(
  input: PaidActor,
  source: NewSource,
  auditAction: "file.uploaded" | null,
): Promise<SourceView> {
  const { owner, staff } = input;
  assertCan(staff, "source.add");
  const db = sql();

  // Sources registered long ago whose file never came are cleared, so they do
  // not fill the Workspace. One attached in a Session is kept for a month: it
  // may be read again when the Session is reopened.
  const stale = await db<{ storage_path: string | null }[]>`
    delete from harness.sources
    where owner = ${owner} and status = 'pending' and not is_seed
      and created_at < now() - case when session_id is null
        then interval '1 day' else interval '30 days' end
    returning storage_path`;
  for (const row of stale.slice(0, 20)) {
    if (row.storage_path) await removeFile(row.storage_path);
  }

  const [count] = await db<{ n: number }[]>`
    select count(*)::int as n from harness.sources where owner = ${owner}`;
  if ((count?.n ?? 0) >= LIMITS.sourcesPerWorkspace) {
    throw new LimitError(
      `This Workspace holds ${LIMITS.sourcesPerWorkspace} Sources. An admin can remove one first.`,
    );
  }
  // A Source is attached in the Staff member's own Session, never another's.
  const session = source.sessionId
    ? (await writableSession(input, source.sessionId)).id
    : null;
  await takeRate(input.visitor, owner, "source");

  await db`
    insert into harness.sources (
      id, owner, title, kind, storage_path, bytes, status, added_by,
      session_id, document_date, extracted_text
    ) values (
      ${source.id}, ${owner}, ${source.title}, ${source.kind},
      ${source.storagePath}, ${source.bytes}, 'pending', ${staff.id},
      ${session},
      ${source.documentDate}, ${source.text}
    )`;
  const view = await loadSource(db, owner, source.id);
  if (!view) throw new Error("The Source was not saved");
  if (auditAction) {
    await audit({
      owner,
      actor: staffActor(input),
      action: auditAction,
      summary: `Attached ${view.title}`,
      sessionId: view.sessionId,
      target: { kind: "source", id: view.id },
      detail: { kind: view.kind, bytes: view.bytes },
    });
  }
  return view;
}

/**
 * Registers an upload as a `pending` Source and returns a signed URL the
 * browser PUTs the file to (the private `harness` bucket). A pending Source is
 * attached, not yet filed: it has no Passages and search does not find it.
 */
export async function createUpload(
  input: PaidActor & {
    name: string;
    type: string;
    bytes: number;
    sessionId?: string | null;
  },
): Promise<SourceUploadUrlResponse> {
  assertCan(input.staff, "source.add");
  const name = input.name.trim();
  if (!name || name.length > 255) {
    throw new InvalidError("Give the file a name of up to 255 characters.");
  }
  const kind = kindOf(name, input.type) as FileKind | null;
  if (!kind) {
    throw new InvalidError(
      "That kind of file cannot be added. Use a PDF, XLSX, CSV, DOCX, TXT or MD file.",
    );
  }
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) {
    throw new InvalidError("That file is empty.");
  }
  if (input.bytes > LIMITS.uploadBytes) {
    throw new InvalidError(
      `That file is larger than ${Math.round(LIMITS.uploadBytes / 1024 / 1024)} MB.`,
    );
  }

  const id = crypto.randomUUID();
  const storagePath = sourceStorageKey({
    owner: input.owner,
    sourceId: id,
    name,
    kind,
  });
  const source = await registerSource(
    input,
    {
      id,
      title: titleFromName(name),
      kind,
      bytes: Math.trunc(input.bytes),
      storagePath,
      text: null,
      documentDate: null,
      sessionId: input.sessionId ?? null,
    },
    "file.uploaded",
  );
  try {
    return { source, uploadUrl: await uploadUrl(storagePath) };
  } catch (error) {
    // No URL, no upload: do not leave a Source waiting for a file that cannot come.
    await sql()`
      delete from harness.sources
      where id = ${id} and owner = ${input.owner} and status = 'pending'`;
    throw error;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

/**
 * Adds a Source from text the caller already has (a pasted note, a web page
 * the Agent fetched, an MCP client's document) and reads it at once, as
 * `ingestSource` does. Same checks and limits as `createUpload`.
 */
export async function addTextSource(
  input: PaidActor & {
    title: string;
    text: string;
    kind?: "text" | "web";
    /** `YYYY-MM-DD`: the date the document itself carries. */
    documentDate?: string | null;
    sessionId?: string | null;
  },
): Promise<SourceIngestResponse> {
  assertCan(input.staff, "source.add");
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) throw new InvalidError("Give the Source a title.");
  const text = input.text.trim();
  if (text.length < TEXT_MIN_CHARS) {
    throw new InvalidError("There is no text to add.");
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new InvalidError(
      `That text is longer than ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters.`,
    );
  }
  const source = await registerSource(
    input,
    {
      id: crypto.randomUUID(),
      title,
      kind: input.kind ?? "text",
      bytes: new TextEncoder().encode(text).byteLength,
      storagePath: null,
      text,
      documentDate: validDate(input.documentDate),
      sessionId: input.sessionId ?? null,
    },
    null,
  );
  return ingestSource({ ...input, sourceId: source.id });
}

// Ingest ---------------------------------------------------------------------------

type ClaimedRow = TextRow & {
  document_date: string | null;
};

/**
 * Takes a Source for reading: `pending` or `failed` (with attempts left) or
 * `reading` for longer than it can take. Two calls at once read it once.
 */
async function claim(
  owner: Owner,
  sourceId: string,
): Promise<ClaimedRow | null> {
  const [row] = await sql()<ClaimedRow[]>`
    update harness.sources
    set status = 'reading', error = null, reading_at = now(),
        read_attempts = read_attempts + 1
    where id = ${sourceId} and owner = ${owner} and not is_seed
      and read_attempts < ${MAX_READS}
      and (
        status in ('pending', 'failed')
        or (status = 'reading'
            and reading_at < now() - make_interval(mins => ${STALE_READING_MINUTES}))
      )
    returning id, title, kind, storage_path, extracted_text,
              to_char(document_date, 'YYYY-MM-DD') as document_date`;
  return row ?? null;
}

const FAILED_MESSAGE = "Reading this file failed. Try again.";

async function fail(owner: Owner, sourceId: string, error: unknown) {
  const message =
    error instanceof UnreadableError || error instanceof InvalidError
      ? error.message
      : FAILED_MESSAGE;
  if (!(error instanceof UnreadableError)) {
    console.error("[harness] ingest failed", error);
  }
  await sql()`
    update harness.sources set status = 'failed', error = ${message}
    where id = ${sourceId} and owner = ${owner} and status = 'reading'`;
}

type InsertedPassage = {
  id: number;
  ordinal: number;
  heading: string | null;
  body: string;
};

/**
 * Reads an uploaded Source into Passages, embeds them, and checks the new
 * Passages against the old ones for Conflicts. Moves the Source `pending` →
 * `reading` → `ready`, or to `failed` with a message a person can act on.
 * Nothing is superseded here: a person settles a Conflict.
 *
 * Safe to retry: a Source that is `ready` is returned as it is, a read in
 * progress is not started twice, a failed one may be read again (a few times),
 * and a read that died is taken over after a few minutes.
 */
export async function ingestSource(
  input: PaidActor & { sourceId: string },
): Promise<SourceIngestResponse> {
  const { owner, staff } = input;
  assertCan(staff, "source.add");
  if (!isUuid(input.sourceId))
    throw new NotFoundError("That Source is not in this Workspace.");
  const started = Date.now();

  const claimed = await claim(owner, input.sourceId);
  if (!claimed) {
    const view = await loadSource(sql(), owner, input.sourceId);
    if (!view) throw new NotFoundError("That Source is not in this Workspace.");
    return {
      source: view,
      conflicts: await loadConflicts(sql(), owner, { sourceId: view.id }),
    };
  }

  try {
    const text = await textOf(owner, claimed);
    const { passages: drafts, truncated } = splitSource(claimed.kind, text, {
      label: claimed.title,
    });
    if (drafts.length === 0) {
      throw new UnreadableError("No readable text was found in this file.");
    }
    const documentDate = claimed.document_date ?? findDocumentDate(text);

    const embedded = await embedAll(
      drafts.map((draft) => embeddingText(draft)),
    );
    const inserted = await sql().begin(async (tx) => {
      // Still ours? A removed or taken-over Source is left alone.
      const [mine] = await tx<{ id: string }[]>`
        select id from harness.sources
        where id = ${claimed.id} and owner = ${owner} and status = 'reading'
        for update`;
      if (!mine) throw new StateError("This Source changed while it was read.");
      // A retry starts from nothing: its old Passages (and their Conflicts) go.
      await tx`delete from harness.passages where source_id = ${claimed.id}`;
      const rows = await tx<InsertedPassage[]>`
        insert into harness.passages ${tx(
          drafts.map((draft, ordinal) => ({
            source_id: claimed.id,
            owner,
            ordinal,
            heading: draft.heading,
            body: draft.body,
          })),
        )}
        returning id, ordinal, heading, body`;
      await setEmbeddingsByOrdinal(
        tx,
        claimed.id,
        embedded.vectors.flatMap((embedding, ordinal) =>
          embedding ? [{ ordinal, embedding }] : [],
        ),
      );
      if (documentDate) {
        await tx`
          update harness.sources set document_date = ${documentDate}
          where id = ${claimed.id} and document_date is null`;
      }
      return rows;
    });

    // The old Passages are compared by meaning, so any still waiting for an
    // embedding (a Workspace seeded a moment ago) are embedded first.
    if (
      embedded.vectors.some(Boolean) &&
      (await hasUnembedded(owner).catch(() => false))
    ) {
      await backfillKnowledge(owner).catch((error) => {
        console.error(
          "[harness] could not embed Passages before a check",
          error,
        );
      });
    }

    const checked = await checkForConflicts({
      owner,
      source: { id: claimed.id, title: claimed.title, documentDate },
      passages: inserted
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((row) => ({
          id: Number(row.id),
          heading: row.heading,
          body: row.body,
          embedding: embedded.vectors[row.ordinal] ?? null,
        })),
      deadline: started + INGEST_BUDGET_MS,
      stubbed: await modelStubbed(input.visitor.trusted),
    });

    const conflictIds = await sql().begin(async (tx) => {
      const [mine] = await tx<{ id: string }[]>`
        select id from harness.sources
        where id = ${claimed.id} and owner = ${owner} and status = 'reading'
        for update`;
      if (!mine) throw new StateError("This Source changed while it was read.");
      const ids: { id: string; conflictOf: (typeof checked.found)[number] }[] =
        [];
      for (const found of checked.found) {
        const [row] = await tx<{ id: string }[]>`
          insert into harness.conflicts (
            owner, new_passage_id, old_passage_id, summary, proposal, reasoning
          ) values (
            ${owner}, ${found.newPassageId}, ${found.oldPassageId},
            ${found.summary}, ${found.proposal}, ${found.reasoning}
          )
          on conflict (new_passage_id, old_passage_id) do nothing
          returning id`;
        if (row) ids.push({ id: row.id, conflictOf: found });
      }
      await tx`
        update harness.sources set status = 'ready', error = null
        where id = ${claimed.id} and owner = ${owner}`;

      const quiet = quietTotal(checked.quietUsage);
      await auditIn(tx, {
        owner,
        actor: staffActor(input),
        action: "source.added",
        summary: `Filed ${claimed.title}: ${drafts.length} Passages, ${ids.length} Conflicts`,
        sessionId: await sessionOf(tx, owner, claimed.id),
        target: { kind: "source", id: claimed.id },
        detail: {
          kind: claimed.kind,
          passages: drafts.length,
          embedded: embedded.vectors.filter(Boolean).length,
          embeddingModel: embedded.usage?.model ?? null,
          embeddingTokens: embedded.usage?.inputTokens ?? 0,
          embeddingCostUsd: embedded.usage?.costUsd ?? null,
          truncated,
          checked: checked.asked,
          notChecked: checked.skipped,
          checksFailed: checked.failed,
          conflicts: ids.length,
        },
        usage: quiet,
      });
      for (const { id, conflictOf } of ids) {
        await auditIn(tx, {
          owner,
          actor: { kind: "agent" },
          action: "conflict.found",
          summary: conflictOf.summary,
          sessionId: await sessionOf(tx, owner, claimed.id),
          target: { kind: "conflict", id },
          detail: {
            sourceId: claimed.id,
            newPassageId: conflictOf.newPassageId,
            oldPassageId: conflictOf.oldPassageId,
            proposal: conflictOf.proposal,
          },
          usage: conflictOf.usage,
        });
      }
      return ids.map((entry) => entry.id);
    });

    const source = await loadSource(sql(), owner, claimed.id);
    if (!source)
      throw new NotFoundError("That Source is not in this Workspace.");
    const conflicts = (
      await loadConflicts(sql(), owner, { sourceId: claimed.id })
    ).filter((conflict) => conflictIds.includes(conflict.id));
    return { source, conflicts };
  } catch (error) {
    await fail(owner, claimed.id, error).catch((inner) => {
      console.error("[harness] could not mark a Source failed", inner);
    });
    const view = await loadSource(sql(), owner, claimed.id);
    if (view?.status === "failed") return { source: view, conflicts: [] };
    throw error;
  }
}

async function sessionOf(db: Db, owner: Owner, sourceId: string) {
  const [row] = await db<{ session_id: string | null }[]>`
    select session_id from harness.sources where id = ${sourceId} and owner = ${owner}`;
  return row?.session_id ?? null;
}

/** The model calls of the Conflict check that found nothing, as one cost. */
function quietTotal(calls: AuditUsage[]): AuditUsage | null {
  const [first] = calls;
  if (!first) return null;
  return calls.slice(1).reduce<AuditUsage>(
    (sum, call) => ({
      model: sum.model,
      inputTokens: sum.inputTokens + call.inputTokens,
      outputTokens: sum.outputTokens + call.outputTokens,
      costUsd:
        sum.costUsd === null && call.costUsd === null
          ? null
          : (sum.costUsd ?? 0) + (call.costUsd ?? 0),
    }),
    first,
  );
}

// Removing -------------------------------------------------------------------------

/**
 * Removes a Source that is not a seed, with its Passages and Conflicts and its
 * file. A Passage it had superseded is live again. Checks `can(staff,
 * "source.remove")` and writes `source.removed`.
 */
export async function removeSource(
  input: Actor & { sourceId: string },
): Promise<void> {
  const { owner, staff } = input;
  assertCan(staff, "source.remove");
  if (!isUuid(input.sourceId))
    throw new NotFoundError("That Source is not in this Workspace.");
  const path = await sql().begin(async (tx) => {
    const [row] = await tx<
      {
        id: string;
        title: string;
        is_seed: boolean;
        storage_path: string | null;
        kind: string;
        session_id: string | null;
      }[]
    >`
      select id, title, is_seed, storage_path, kind, session_id
      from harness.sources
      where id = ${input.sourceId} and owner = ${owner}
      for update`;
    if (!row) throw new NotFoundError("That Source is not in this Workspace.");
    if (row.is_seed) {
      throw new InvalidError("A seed Source cannot be removed.");
    }
    await tx`delete from harness.sources where id = ${row.id} and owner = ${owner}`;
    // Passages it superseded lost their replacement: they stand again.
    const restored = await tx<{ id: number }[]>`
      update harness.passages set superseded_at = null
      where owner = ${owner} and superseded_by is null and superseded_at is not null
      returning id`;
    await auditIn(tx, {
      owner,
      actor: staffActor(input),
      action: "source.removed",
      summary: `Removed ${row.title}`,
      sessionId: row.session_id,
      target: { kind: "source", id: row.id },
      detail: { kind: row.kind, passagesRestored: restored.length },
    });
    return row.storage_path;
  });
  if (path) await removeFile(path);
}

// Conflicts ------------------------------------------------------------------------

/** The Workspace's Conflicts, open first, then newest. */
export async function listConflicts(
  owner: Owner,
  filter: { status?: "open" | "resolved" | null } = {},
): Promise<ConflictView[]> {
  return loadConflicts(sql(), owner, { status: filter.status ?? null });
}

/**
 * A person settles a Conflict: the new Passage supersedes the old one, both
 * stay, or the new one is set aside (it is marked superseded by the old).
 * Settling twice is a StateError. The Passage mark and the Audit event are
 * one transaction.
 */
export async function resolveConflict(
  input: Actor & { conflictId: string; resolution: Resolution },
): Promise<ConflictView> {
  const { owner, staff } = input;
  assertCan(staff, "conflict.resolve");
  if (!(RESOLUTIONS as readonly string[]).includes(input.resolution)) {
    throw new InvalidError(
      "Choose how to settle it: supersede, keep both or set aside.",
    );
  }
  if (!isUuid(input.conflictId))
    throw new NotFoundError("That Conflict is not in this Workspace.");

  await sql().begin(async (tx) => {
    const [row] = await tx<
      {
        id: string;
        status: "open" | "resolved";
        new_passage_id: number;
        old_passage_id: number;
        summary: string;
      }[]
    >`
      select id, status, new_passage_id, old_passage_id, summary
      from harness.conflicts
      where id = ${input.conflictId} and owner = ${owner}
      for update`;
    if (!row)
      throw new NotFoundError("That Conflict is not in this Workspace.");
    const plan = planResolution(
      {
        status: row.status,
        newPassageId: Number(row.new_passage_id),
        oldPassageId: Number(row.old_passage_id),
      },
      input.resolution,
    );
    if (!plan.ok) throw new StateError(plan.reason);
    const claimed = await tx<{ id: string }[]>`
      update harness.conflicts
      set status = 'resolved', resolution = ${input.resolution},
          decided_by = ${staff.id}, decided_at = now()
      where id = ${row.id} and status = 'open'
      returning id`;
    if (claimed.length === 0) {
      throw new StateError("That Conflict has already been settled.");
    }
    if (plan.supersede) {
      await tx`
        update harness.passages
        set superseded_by = ${plan.supersede.by}, superseded_at = now()
        where id = ${plan.supersede.passageId} and owner = ${owner}
          and superseded_by is null`;
    }
    await auditIn(tx, {
      owner,
      actor: staffActor(input),
      action: "conflict.resolved",
      summary: `Settled a Conflict: ${input.resolution.replace("_", " ")}`,
      target: { kind: "conflict", id: row.id },
      detail: {
        resolution: input.resolution,
        supersededPassageId: plan.supersede?.passageId ?? null,
        replacedBy: plan.supersede?.by ?? null,
      },
    });
  });

  const [conflict] = await loadConflicts(sql(), owner, {
    id: input.conflictId,
  });
  if (!conflict)
    throw new NotFoundError("That Conflict is not in this Workspace.");
  return conflict;
}
