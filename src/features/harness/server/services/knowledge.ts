import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import {
  PREVIEW_URL_SECONDS,
  type PreviewFormat,
  type SourceIngestResponse,
  type SourcePreviewResponse,
  type SourceResponse,
  type SourceUploadUrlResponse,
} from "../../domain/api";
import type { AuditUsage } from "../../domain/audit";
import {
  type ConflictView,
  type PassageHit,
  RESOLUTIONS,
  type Resolution,
  type SourceView,
} from "../../domain/knowledge";
import { planResolution } from "../../domain/knowledge/conflicts";
import { findDocumentDate } from "../../domain/knowledge/dates";
import {
  type FileKind,
  kindOf,
  sourceStorageKey,
  titleFromName,
} from "../../domain/knowledge/file-kind";
import {
  embeddingText,
  MAX_TEXT_CHARS,
  splitSource,
} from "../../domain/knowledge/split";
import { LIMITS } from "../../domain/limits";
import { isUuid } from "../db";
import { assertCan, SourceChangedError, UnreadableError } from "../errors";
import type {
  Actor,
  AuditLog,
  ConflictChecker,
  Embedder,
  HarnessRate,
  KnowledgeRepository,
  Later,
  NewSource,
  PaidActor,
  SourceFiles,
  SourceTexts,
} from "../ports";
import type { SessionService } from "./sessions";

/** Reads of one Source that may be tried before it stays failed (each costs model calls). */
const MAX_READS = 3;
/** No Conflict check starts after this long into one ingest, so the route's limit is kept. */
const INGEST_BUDGET_MS = 40_000;
const QUERY_CHARS = 500;
const TEXT_MIN_CHARS = 20;
/** The most text a preview sends; the full length is still reported. */
const PREVIEW_TEXT_CHARS = 200_000;
const FAILED_MESSAGE = "Reading this file failed. Try again.";
/** Passages embedded by one backfill; a Workspace's seed is about forty. */
const BACKFILL_CAP = 320;
const BACKFILL_PAGE = 64;
/** How long one instance waits before it tries to embed an Owner's Passages again. */
const BACKFILL_RETRY_MS = 10 * 60 * 1000;
const NOT_HERE = "That Source is not in this Workspace.";

const FORMATS: Record<string, PreviewFormat> = {
  pdf: "pdf",
  csv: "csv",
  xlsx: "xlsx",
  docx: "docx",
  md: "md",
  txt: "txt",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
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

const staffActor = (actor: Actor) => ({
  kind: "staff" as const,
  staff: actor.staff,
});

/**
 * The Knowledge base (ADR 0016): Sources, the Passages search finds, and
 * Conflicts. Every call is scoped to the Owner; every write checks the Role
 * and is audited. A file attached in a Session is a `pending` Source
 * ("attached, not filed"): it has no Passages and no Conflict check until it
 * is filed (`ingest`). Removing a Source is soft.
 */
export interface KnowledgeService {
  /**
   * Passages by words and meaning. A new query is a paid embedding, so it
   * takes one of the visitor's searches this hour; past the cap (or with
   * no gateway) it searches by words alone rather than failing.
   */
  search(actor: PaidActor, query: string, limit: number): Promise<PassageHit[]>;
  /** Newest first, seed Sources after; `filedOnly` leaves out attached-but-unfiled ones. */
  sources(
    actor: Actor,
    options?: { filedOnly?: boolean },
  ): Promise<SourceView[]>;
  /** A Source with its Passages in order, superseded ones marked. */
  source(actor: Actor, sourceId: string): Promise<SourceResponse>;
  /** A Source and its text, filed or not (the Agent reading an attachment). */
  text(
    actor: Actor,
    sourceId: string,
  ): Promise<{ source: SourceView; text: string }>;
  /** The raw text and a 5-minute link to the file, recorded as `source.read`. */
  preview(actor: Actor, sourceId: string): Promise<SourcePreviewResponse>;
  /** Registers a `pending` Source and answers the signed URL the browser PUTs the file to. */
  upload(
    actor: PaidActor,
    file: {
      name: string;
      type: string;
      bytes: number;
      sessionId?: string | null;
    },
  ): Promise<SourceUploadUrlResponse>;
  /** A Source from text the caller has (a pasted note, a fetched page), filed at once. */
  addText(
    actor: PaidActor,
    input: {
      title: string;
      text: string;
      kind?: "text" | "web";
      documentDate?: string | null;
      sessionId?: string | null;
    },
  ): Promise<SourceIngestResponse>;
  /**
   * Files a Source: its Passages, their embeddings and a Conflict check
   * against the old ones. Safe to retry: a `ready` Source is returned as it
   * is, a read in progress is not started twice, a failed one may be read
   * again a few times, a read that died is taken over.
   */
  ingest(actor: PaidActor, sourceId: string): Promise<SourceIngestResponse>;
  /** Removes a Source that is not a seed (admin); soft, purged 30 days later. */
  remove(actor: Actor, sourceId: string): Promise<void>;
  conflicts(
    actor: Actor,
    filter?: { status?: "open" | "resolved" | null },
  ): Promise<ConflictView[]>;
  /** An admin settles a Conflict: supersede, keep both or set aside. Twice is a 409. */
  resolve(
    actor: Actor,
    conflictId: string,
    resolution: Resolution,
  ): Promise<ConflictView>;
  /** Embeds the Owner's Passages that have none yet (the seed's, or a failed embed). Never throws. */
  backfill(owner: Owner): Promise<void>;
}

export function createKnowledgeService(ports: {
  knowledge: KnowledgeRepository;
  texts: SourceTexts;
  files: SourceFiles;
  embedder: Embedder;
  conflicts: ConflictChecker;
  sessions: Pick<SessionService, "writable">;
  rate: HarnessRate;
  audit: AuditLog;
  later: Later;
  newId: () => string;
  now: () => number;
}): KnowledgeService {
  const { knowledge, embedder, files } = ports;
  /** Query embeddings this instance has paid for already. */
  const queryVectors = new Map<string, number[]>();
  /** When this instance last tried to embed each Owner's Passages. */
  const tried = new Map<Owner, number>();

  async function queryVector(
    actor: PaidActor,
    text: string,
  ): Promise<number[] | null> {
    const cached = queryVectors.get(text);
    if (cached) return cached;
    try {
      await ports.rate.take("search", actor.visitor, { owner: actor.owner });
    } catch (error) {
      if (error instanceof LimitError) return null;
      throw error;
    }
    const vector = await embedder.embedQuery(text);
    if (!vector) return null;
    if (queryVectors.size >= 100) queryVectors.clear();
    queryVectors.set(text, vector);
    return vector;
  }

  async function backfill(owner: Owner) {
    try {
      let done = 0;
      while (done < BACKFILL_CAP) {
        const rows = await knowledge.unembedded(owner, BACKFILL_PAGE);
        if (rows.length === 0) return;
        const { vectors } = await embedder.embedAll(
          rows.map((row) => embeddingText(row)),
        );
        const filled = rows.flatMap((row, index) => {
          const embedding = vectors[index];
          return embedding ? [{ id: row.id, embedding }] : [];
        });
        // Nothing came back (no key, a limit, the stub): give up for now rather than loop.
        if (filled.length === 0) return;
        await knowledge.setEmbeddings(filled);
        done += rows.length;
        if (rows.length < BACKFILL_PAGE) return;
      }
    } catch (error) {
      console.error("[harness] could not embed Passages", error);
    }
  }

  /** At most once in a while per Owner and instance, after the answer. */
  function backfillSoon(owner: Owner) {
    const now = ports.now();
    const last = tried.get(owner);
    if (last !== undefined && now - last < BACKFILL_RETRY_MS) return;
    tried.set(owner, now);
    if (tried.size > 500) tried.clear();
    ports.later(async () => {
      if (await knowledge.hasUnembedded(owner)) await backfill(owner);
    });
  }

  /** Deletes stale pending and long-removed Sources, and their files. */
  async function sweep(owner: Owner) {
    const paths = await knowledge.sweep(owner);
    for (const path of paths) await files.remove(path);
  }

  /** The checks and the row an upload and a text Source share. */
  async function register(
    actor: PaidActor,
    source: Omit<NewSource, "addedBy">,
  ): Promise<SourceView> {
    const { owner } = actor;
    assertCan(actor.staff, "source.add");
    await sweep(owner);
    // The cap, the Session (only the Staff member's own) and the rate, before any row.
    const [count, session] = await Promise.all([
      knowledge.count(owner),
      source.sessionId
        ? ports.sessions.writable(actor, source.sessionId)
        : null,
    ]);
    if (count >= LIMITS.sourcesPerWorkspace) {
      throw new LimitError(
        `This Workspace holds ${LIMITS.sourcesPerWorkspace} Sources. An admin can remove one first.`,
      );
    }
    await ports.rate.take("source", actor.visitor, { owner });
    await knowledge.insert(owner, {
      ...source,
      sessionId: session?.id ?? null,
      addedBy: actor.staff.id,
    });
    const view = await knowledge.source(owner, source.id);
    if (!view) throw new Error("The Source was not saved");
    return view;
  }

  async function ingest(
    actor: PaidActor,
    sourceId: string,
  ): Promise<SourceIngestResponse> {
    const { owner } = actor;
    assertCan(actor.staff, "source.add");
    if (!isUuid(sourceId)) throw new NotFoundError(NOT_HERE);
    const started = ports.now();

    const claimed = await knowledge.claim(owner, sourceId, MAX_READS);
    if (!claimed) {
      const [view, conflicts] = await Promise.all([
        knowledge.source(owner, sourceId),
        knowledge.conflicts(owner, { sourceId }),
      ]);
      if (!view) throw new NotFoundError(NOT_HERE);
      return { source: view, conflicts };
    }

    try {
      const text = await ports.texts.of(owner, claimed);
      const { passages: drafts, truncated } = splitSource(claimed.kind, text, {
        label: claimed.title,
      });
      if (drafts.length === 0) {
        throw new UnreadableError("No readable text was found in this file.");
      }
      const documentDate = claimed.document_date ?? findDocumentDate(text);
      const embedded = await embedder.embedAll(
        drafts.map((draft) => embeddingText(draft)),
      );
      const inserted = await knowledge.savePassages({
        owner,
        sourceId: claimed.id,
        passages: drafts,
        vectors: embedded.vectors,
        documentDate,
      });

      // The old Passages are compared by meaning, so any still waiting for
      // an embedding (a Workspace seeded a moment ago) are embedded first.
      if (
        embedded.vectors.some(Boolean) &&
        (await knowledge.hasUnembedded(owner).catch(() => false))
      ) {
        await backfill(owner);
      }

      const checked = await ports.conflicts.check({
        owner,
        source: { id: claimed.id, title: claimed.title, documentDate },
        passages: inserted
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((row) => ({
            id: row.id,
            heading: row.heading,
            body: row.body,
            embedding: embedded.vectors[row.ordinal] ?? null,
          })),
        deadline: started + INGEST_BUDGET_MS,
      });

      const conflictIds = await knowledge.file({
        owner,
        sourceId: claimed.id,
        found: checked.found,
        event: (sessionId, conflicts) => ({
          owner,
          actor: staffActor(actor),
          action: "source.added",
          summary: `Filed ${claimed.title}: ${drafts.length} Passages, ${conflicts} Conflicts`,
          sessionId,
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
            conflicts,
          },
          usage: quietTotal(checked.quietUsage),
        }),
        conflictEvent: (sessionId, conflictId, found) => ({
          owner,
          actor: { kind: "agent" },
          action: "conflict.found",
          summary: found.summary,
          sessionId,
          target: { kind: "conflict", id: conflictId },
          detail: {
            sourceId: claimed.id,
            newPassageId: found.newPassageId,
            oldPassageId: found.oldPassageId,
            proposal: found.proposal,
          },
          usage: found.usage,
        }),
      });

      const [source, conflicts] = await Promise.all([
        knowledge.source(owner, claimed.id),
        knowledge.conflicts(owner, { sourceId: claimed.id }),
      ]);
      if (!source) throw new NotFoundError(NOT_HERE);
      return {
        source,
        conflicts: conflicts.filter((conflict) =>
          conflictIds.includes(conflict.id),
        ),
      };
    } catch (error) {
      const readable =
        error instanceof UnreadableError || error instanceof InvalidError;
      if (!readable) console.error("[harness] ingest failed", error);
      await knowledge
        .fail(owner, claimed.id, readable ? error.message : FAILED_MESSAGE)
        .catch((inner) => {
          console.error("[harness] could not mark a Source failed", inner);
        });
      const view = await knowledge.source(owner, claimed.id);
      if (view?.status === "failed") return { source: view, conflicts: [] };
      if (error instanceof SourceChangedError)
        throw new ConflictError("This Source changed while it was read.");
      throw error;
    }
  }

  return {
    async search(actor, query, limit) {
      const text = query.replace(/\s+/g, " ").trim().slice(0, QUERY_CHARS);
      if (!text) return [];
      const count = Math.max(1, Math.min(Math.trunc(limit) || 8, 25));
      const vector = await queryVector(actor, text);
      const hits = await knowledge.search(actor.owner, text, vector, count);
      backfillSoon(actor.owner);
      return hits;
    },

    async sources(actor, options = {}) {
      await knowledge.clearStale(actor.owner);
      const sources = await knowledge.sources(actor.owner);
      return options.filedOnly
        ? sources.filter((source) => source.status !== "pending")
        : sources;
    },

    async source(actor, sourceId) {
      if (!isUuid(sourceId)) throw new NotFoundError(NOT_HERE);
      await knowledge.clearStale(actor.owner);
      // Both are the Owner's; the Passages are answered only with their Source.
      const [source, passages] = await Promise.all([
        knowledge.source(actor.owner, sourceId),
        knowledge.passages(actor.owner, sourceId),
      ]);
      if (!source) throw new NotFoundError(NOT_HERE);
      return { source, passages };
    },

    async text(actor, sourceId) {
      const read = await ports.texts.read(actor.owner, sourceId);
      if (!read) throw new NotFoundError(NOT_HERE);
      return read;
    },

    async preview(actor, sourceId) {
      const { owner } = actor;
      if (!isUuid(sourceId)) throw new NotFoundError(NOT_HERE);
      const [row, source] = await Promise.all([
        knowledge.textRow(owner, sourceId),
        knowledge.source(owner, sourceId),
      ]);
      if (!row || !source) throw new NotFoundError(NOT_HERE);

      let full: string | null = null;
      let textError: string | null = null;
      try {
        full = await ports.texts.of(owner, row);
      } catch (error) {
        if (!(error instanceof UnreadableError)) throw error;
        textError = error.message;
      }
      if (full === null && source.status !== "pending") {
        // A filed Source with no stored text (a seed): its Passages, in order.
        const passages = await knowledge.passages(owner, sourceId);
        if (passages.length > 0) {
          full = passages
            .map((p) => (p.heading ? `${p.heading}\n${p.body}` : p.body))
            .join("\n\n");
          textError = null;
        }
      }

      let file: SourcePreviewResponse["file"] = null;
      if (row.storage_path) {
        const name = row.storage_path.split("/").pop() ?? "file";
        const format = FORMATS[name.split(".").pop()?.toLowerCase() ?? ""];
        if (format) {
          try {
            file = {
              url: await files.signedUrl(row.storage_path, PREVIEW_URL_SECONDS),
              expiresAt: new Date(
                ports.now() + PREVIEW_URL_SECONDS * 1000,
              ).toISOString(),
              name,
              format,
            };
          } catch (error) {
            console.error("[harness] could not sign a preview URL", error);
          }
        }
      }

      await ports.audit.record({
        owner,
        actor: staffActor(actor),
        action: "source.read",
        summary: `Previewed ${source.title}`,
        target: { kind: "source", id: source.id },
        detail: {
          kind: source.kind,
          status: source.status,
          chars: full?.length ?? 0,
          file: file !== null,
        },
      });
      return {
        source,
        text: full === null ? null : full.slice(0, PREVIEW_TEXT_CHARS),
        textChars: full?.length ?? 0,
        truncated: (full?.length ?? 0) > PREVIEW_TEXT_CHARS,
        textError,
        file,
      };
    },

    async upload(actor, file) {
      assertCan(actor.staff, "source.add");
      const name = file.name.trim();
      if (!name || name.length > 255) {
        throw new InvalidError("Give the file a name of up to 255 characters.");
      }
      const kind = kindOf(name, file.type) as FileKind | null;
      if (!kind) {
        throw new InvalidError(
          "That kind of file cannot be added. Use a PDF, XLSX, CSV, DOCX, TXT or MD file.",
        );
      }
      if (!Number.isFinite(file.bytes) || file.bytes <= 0) {
        throw new InvalidError("That file is empty.");
      }
      if (file.bytes > LIMITS.uploadBytes) {
        throw new InvalidError(
          `That file is larger than ${Math.round(LIMITS.uploadBytes / 1024 / 1024)} MB.`,
        );
      }
      const id = ports.newId();
      const storagePath = sourceStorageKey({
        owner: actor.owner,
        sourceId: id,
        name,
        kind,
      });
      const source = await register(actor, {
        id,
        title: titleFromName(name),
        kind,
        bytes: Math.trunc(file.bytes),
        storagePath,
        text: null,
        documentDate: null,
        sessionId: file.sessionId ?? null,
      });
      await ports.audit.record({
        owner: actor.owner,
        actor: staffActor(actor),
        action: "file.uploaded",
        summary: `Attached ${source.title}`,
        sessionId: source.sessionId,
        target: { kind: "source", id: source.id },
        detail: { kind: source.kind, bytes: source.bytes },
      });
      try {
        return { source, uploadUrl: await files.uploadUrl(storagePath) };
      } catch (error) {
        // No URL, no upload: do not leave a Source waiting for a file that cannot come.
        await knowledge.dropPending(actor.owner, id);
        throw error;
      }
    },

    async addText(actor, input) {
      assertCan(actor.staff, "source.add");
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
      const source = await register(actor, {
        id: ports.newId(),
        title,
        kind: input.kind ?? "text",
        bytes: new TextEncoder().encode(text).byteLength,
        storagePath: null,
        text,
        documentDate: validDate(input.documentDate),
        sessionId: input.sessionId ?? null,
      });
      return ingest(actor, source.id);
    },

    ingest,

    async remove(actor, sourceId) {
      const { owner } = actor;
      assertCan(actor.staff, "source.remove");
      await knowledge.remove({
        owner,
        sourceId,
        check: (row) => {
          if (!row) throw new NotFoundError(NOT_HERE);
          if (row.isSeed)
            throw new InvalidError("A seed Source cannot be removed.");
        },
        event: (row, passagesRestored) => ({
          owner,
          actor: staffActor(actor),
          action: "source.removed",
          summary: `Removed ${row.title}`,
          sessionId: row.sessionId,
          target: { kind: "source", id: row.id },
          detail: { kind: row.kind, passagesRestored },
        }),
      });
      await sweep(owner).catch((error) => {
        console.error("[harness] could not purge removed Sources", error);
      });
    },

    conflicts: (actor, filter = {}) =>
      knowledge.conflicts(actor.owner, { status: filter.status ?? null }),

    async resolve(actor, conflictId, resolution) {
      const { owner, staff } = actor;
      assertCan(staff, "conflict.resolve");
      if (!(RESOLUTIONS as readonly string[]).includes(resolution)) {
        throw new InvalidError(
          "Choose how to settle it: supersede, keep both or set aside.",
        );
      }
      const NOT_THERE = "That Conflict is not in this Workspace.";
      if (!isUuid(conflictId)) throw new NotFoundError(NOT_THERE);
      const settled = await knowledge.settle({
        owner,
        conflictId,
        decidedBy: staff.id,
        resolution,
        plan: (row) => {
          if (!row) throw new NotFoundError(NOT_THERE);
          const plan = planResolution(row, resolution);
          if (!plan.ok) throw new ConflictError(plan.reason);
          return {
            supersede: plan.supersede ?? null,
            event: {
              owner,
              actor: staffActor(actor),
              action: "conflict.resolved",
              summary: `Settled a Conflict: ${resolution.replace("_", " ")}`,
              target: { kind: "conflict", id: conflictId },
              detail: {
                resolution,
                supersededPassageId: plan.supersede?.passageId ?? null,
                replacedBy: plan.supersede?.by ?? null,
              },
            },
          };
        },
      });
      if (!settled)
        throw new ConflictError("That Conflict has already been settled.");
      const [conflict] = await knowledge.conflicts(owner, { id: conflictId });
      if (!conflict) throw new NotFoundError(NOT_THERE);
      return conflict;
    },

    backfill,
  };
}
