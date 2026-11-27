import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import type { AuditResponse, CorpusResponse } from "../../domain/api";
import type {
  DocumentFormat,
  DocumentKind,
  DocumentSource,
  Driver,
  ExaminationDetail,
  ExaminationStatus,
  ExaminationSummary,
  StoredEvent,
  Verdict,
} from "../../domain/contract";
import {
  MANIFEST,
  manifestEntry,
  RECORDED,
  sampleFiles,
  samplePages,
} from "../../domain/corpus";
import { LIMITS, STALE_EXAMINATION_MS } from "../../domain/limits";
import type { RulebookVersion } from "../../domain/rules";
import {
  type ExaminationPulse,
  type ExaminationRow,
  isOver,
  isUuid,
  standingOf,
  toSummary,
} from "../examination";
import type { ExaminationRefusal, LoupePorts, Who } from "../ports";
import { assetPath, contentTypeOf, isAssetKey } from "../storage";
import type { Ending, StaleCheck } from "./ending";
import type { Shared } from "./shared";

export type Reevaluated = {
  examinationId: string;
  fromVersion: number;
  toVersion: number;
  from: Verdict;
  to: Verdict;
  findings: number;
};

export type Stopped = {
  examinationId: string;
  stopped: boolean;
  status: ExaminationStatus;
};

/** An image of an Examination for an outside client: a Sample's static file, or the bytes. */
export type Evidence =
  | { kind: "url"; url: string }
  | { kind: "image"; ref: string; bytes: Buffer; mediaType: string };

/**
 * Everything about an Owner's Examinations outside the Examiner's own tools.
 * The REST routes, the MCP server and the page all call it, so Owner
 * scoping, the caps and the Audit trail hold whoever calls (ADR 0028).
 */
export interface ExaminationService {
  list(owner: Owner): Promise<ExaminationSummary[]>;
  /**
   * An Examination with its Trail. Page images and Evidence layers are refs:
   * one starting with "/" is a static Sample file; anything else is an asset
   * key of this Examination, served by `asset` to its Owner.
   */
  detail(owner: Owner, examinationId: string): Promise<ExaminationDetail>;
  /** A page image or an Evidence layer of one of the Owner's Examinations, by its key. */
  asset(
    owner: Owner,
    examinationId: string,
    key: unknown,
  ): Promise<{ bytes: Buffer; contentType: string }>;
  /**
   * The Trail as it is written, after `after`, until the `end` event or
   * about 280 s (the client reconnects with the last seq). Resolves once the
   * Examination is found to be the Owner's; then the events stream.
   */
  follow(
    owner: Owner,
    examinationId: string,
    after: number,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<StoredEvent>>;
  /** A page of the Trail, for `read_trail`. */
  trailPage(
    owner: Owner,
    examinationId: string,
    after: number,
    limit: number,
  ): Promise<{ events: StoredEvent[]; next: number }>;
  evidence(
    who: Pick<Who, "owner" | "origin">,
    input: { examinationId: string; page?: number; findingId?: string },
  ): Promise<Evidence>;
  /**
   * Starts an Examination of a Sample or an Upload under the limits (per
   * Owner per day, per visitor per hour, a few going at once). The Rulebook
   * is the Owner's current version, kept on the Examination.
   */
  start(
    who: Who,
    input: { source: DocumentSource; driver?: Driver; model?: string },
  ): Promise<{ examinationId: string }>;
  /**
   * Stops an Examination. The local state change comes first and always
   * happens; the workflow cancel and the Sandbox stop are best effort
   * (conventions.md: "Make the escape hatch work when the thing it escapes
   * is broken").
   */
  stop(who: Who, examinationId: string): Promise<Stopped>;
  /**
   * Decides a completed Examination again under the Owner's current
   * Rulebook, from its stored Measurements. No model call and no Sandbox:
   * `evaluate` and `decide` are pure code. The Trail keeps both Verdicts.
   */
  reevaluate(who: Who, examinationId: string): Promise<Reevaluated>;
  audit(owner: Owner): Promise<AuditResponse>;
  /** The Manifest and every recorded Sweep: seed data, the same for everyone. */
  corpus(): CorpusResponse;
  /** What the page shows first: the Owner's Examinations and Rulebook versions. */
  firstView(owner: Owner): Promise<{
    examinations: ExaminationSummary[];
    rulebooks: RulebookVersion[];
  }>;
}

type Described = {
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  isForgery: boolean;
};

// The events stream ------------------------------------------------------------------

const POLL_MS = 600;
/** Ends the stream before the platform does, so the client reconnects cleanly. */
const OPEN_MS = 280_000;
/** Polls an Examination seen over waits for its own `end` before the stream writes one. */
const OVER_GRACE_POLLS = 3;
const PAGE = 500;
/**
 * Events are read from a little behind the cursor, because one that was
 * given its seq first can commit a moment after a later one. The stream
 * drops what it already sent by seq.
 */
const OVERLAP = 12;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

const staleCheck = (row: ExaminationRow): StaleCheck => ({
  id: row.id,
  status: row.status,
  started_at: row.started_at,
  driver: row.state.driver,
  pageCount: row.pages.length,
});

const pulseCheck = (pulse: ExaminationPulse): StaleCheck => ({
  id: pulse.id,
  status: pulse.status,
  started_at: pulse.started_at,
  driver: pulse.driver,
  pageCount: pulse.pageCount,
});

function refusalOf({ over, count }: ExaminationRefusal) {
  switch (over) {
    case "active":
      return `You already have ${count} Examination${count === 1 ? "" : "s"} going. Stop one or let it finish first.`;
    case "day":
      return `That's ${count} Examinations today, the demo's daily limit. Try again tomorrow.`;
    case "hour":
      return `That's ${count} Examinations this hour. Give Loupe a breather and try again later.`;
  }
}

let corpus: CorpusResponse | undefined;

export function createExaminationService(
  ports: Pick<
    LoupePorts,
    | "examinations"
    | "trail"
    | "rulebooks"
    | "uploads"
    | "audit"
    | "rate"
    | "store"
    | "sandbox"
    | "runs"
    | "modelFor"
    | "stub"
    | "now"
  > & { shared: Shared; ending: Ending },
): ExaminationService {
  const { examinations, trail, rulebooks, uploads, store, shared, ending } =
    ports;

  async function describe(
    owner: Owner,
    source: DocumentSource,
  ): Promise<Described> {
    if (source.kind === "sample") {
      const entry = manifestEntry(source.sampleId);
      if (!entry?.featured || !sampleFiles(source.sampleId))
        throw new NotFoundError("No such Sample.");
      return {
        title: entry.title,
        kind: entry.kind,
        format: entry.format,
        isForgery: false,
      };
    }
    const upload = await uploads.owned(owner, source.uploadId);
    if (!upload) throw new NotFoundError("No such Upload.");
    // The browser was handed a signed URL; the file must have arrived, and be the size it said.
    const size = await store.storedSize(upload.storage_path);
    if (size === null)
      throw new InvalidError(
        "The Upload's file was never received. Upload it again.",
      );
    if (size > LIMITS.uploadBytes)
      throw new InvalidError("The Upload is larger than the demo allows.");
    return {
      title: upload.title,
      kind: upload.kind,
      format: upload.format,
      isForgery: Boolean(upload.forgery),
    };
  }

  async function* stream(
    pulse: ExaminationPulse,
    given: number,
    signal: AbortSignal,
  ): AsyncGenerator<StoredEvent> {
    const opened = ports.now();
    const sent = new Set<number>();
    let after = given;
    let overPolls = 0;
    while (!signal.aborted && ports.now() - opened < OPEN_MS) {
      const page = await trail.after(
        pulse.id,
        Math.max(0, after - OVERLAP),
        PAGE,
      );
      const fresh = page.filter(
        (event) => event.seq > given && !sent.has(event.seq),
      );
      for (const event of fresh) {
        sent.add(event.seq);
        after = Math.max(after, event.seq);
        yield event;
        if (event.type === "end") return;
      }
      if (page.length === PAGE) continue;
      if (fresh.length === 0) {
        // An Examination that is over but never wrote `end` (its workflow died) stops here.
        // One lost long ago is closed here too, or the page would reconnect for ever.
        let latest = await examinations.pulse(pulse.id);
        if (latest && (await ending.closeIfStale(pulseCheck(latest))))
          latest = await examinations.pulse(pulse.id);
        if (!latest || isOver(latest.status)) {
          if (overPolls < OVER_GRACE_POLLS) {
            overPolls += 1;
          } else {
            if (latest)
              yield {
                seq: after,
                at: ports.now(),
                type: "end",
                status: latest.status as "completed" | "failed" | "stopped",
                ...(latest.verdict ? { verdict: latest.verdict.verdict } : {}),
                ...(latest.error ? { error: latest.error } : {}),
              };
            return;
          }
        }
      }
      await wait(POLL_MS, signal);
    }
  }

  return {
    list: (owner) => examinations.list(owner),

    async detail(owner, examinationId) {
      // The Trail is read beside the row; it is only answered if the row is the Owner's.
      const [found, events] = await Promise.all([
        examinations.owned(owner, examinationId),
        trail.all(examinationId),
      ]);
      if (!found) throw new NotFoundError("No such Examination.");
      let row = found;
      let trailEvents = events;
      if (await ending.closeIfStale(staleCheck(found))) {
        const [latest, again] = await Promise.all([
          examinations.get(found.id),
          trail.all(found.id),
        ]);
        row = latest ?? found;
        trailEvents = again;
      }
      // While it runs, the row's Findings trail the state by a tool call at most;
      // decide them from the state so the page never shows a stale Verdict.
      const live = row.status === "running" && row.pages.length > 0;
      const standing = live ? standingOf(row, row.state) : null;
      return {
        ...toSummary(row),
        pages: row.pages.length
          ? row.pages
          : row.source.kind === "sample"
            ? samplePages(row.source.sampleId)
            : [],
        measurements: row.state.measurements,
        hypotheses: row.state.hypotheses,
        findingList: standing?.findings ?? row.findings,
        verdictResult: standing?.verdict ?? row.verdict,
        gate: standing?.gate ?? row.gate,
        events: trailEvents,
      };
    },

    async asset(owner, examinationId, key) {
      if (!isAssetKey(key) || !isUuid(examinationId)) throw new NotFoundError();
      // The key is in the Owner's own folder, so the file is read beside the ownership check.
      const [owns, bytes] = await Promise.all([
        examinations.owns(owner, examinationId),
        store.download(assetPath(owner, examinationId, key)),
      ]);
      if (!owns || !bytes) throw new NotFoundError();
      return { bytes, contentType: contentTypeOf(key) };
    },

    async follow(owner, examinationId, after, signal) {
      const pulse = await examinations.pulse(examinationId);
      if (!pulse || pulse.owner !== owner)
        throw new NotFoundError("No such Examination.");
      const given = Number.isFinite(after) && after > 0 ? Math.floor(after) : 0;
      return stream(pulse, given, signal);
    },

    async trailPage(owner, examinationId, after, limit) {
      if (!(await examinations.owns(owner, examinationId)))
        throw new NotFoundError("No such Examination.");
      const events = await trail.after(examinationId, after, limit);
      return { events, next: events.at(-1)?.seq ?? after };
    },

    async evidence(who, input) {
      const row = await examinations.owned(who.owner, input.examinationId);
      if (!row) throw new NotFoundError("No such Examination.");
      const ref = input.findingId
        ? row.state.measurements.find((item) => item.id === input.findingId)
            ?.layer
        : row.pages[(input.page ?? 1) - 1]?.image;
      if (!ref)
        throw new NotFoundError(
          input.findingId
            ? "That Finding has no Evidence layer."
            : "No such page.",
        );
      if (ref.startsWith("/"))
        return { kind: "url", url: `${who.origin}${ref}` };
      if (!isAssetKey(ref)) throw new NotFoundError("No such image.");
      const bytes = await store.download(assetPath(row.owner, row.id, ref));
      if (!bytes) throw new NotFoundError("The image is gone.");
      return {
        kind: "image",
        ref,
        bytes,
        mediaType: ref.endsWith(".png") ? "image/png" : "image/jpeg",
      };
    },

    async start(who, input) {
      const [described, rulebook] = await Promise.all([
        describe(who.owner, input.source),
        rulebooks.current(who.owner),
      ]);
      const driver = input.driver ?? "examiner";
      const stub = ports.stub && who.visitor.trusted;
      if (!stub && !ports.sandbox.live && input.source.kind === "upload")
        throw new ConflictError(
          "Sandbox unavailable: it is not set up here, so only Samples can be examined, from their recorded Sweep.",
        );
      const created = await examinations.create({
        owner: who.owner,
        visitorHash: who.visitor.hash,
        title: described.title,
        kind: described.kind,
        format: described.format,
        source: input.source,
        isForgery: described.isForgery,
        model: ports.modelFor(input.model),
        driver,
        origin: who.origin,
        stub,
        rulebookVersion: rulebook.version,
        rulebook: rulebook.rulebook,
        via: who.via,
        limits: who.visitor.trusted
          ? null
          : {
              perOwnerPerDay: LIMITS.examinationsPerOwnerPerDay,
              perVisitorPerHour: LIMITS.examinationsPerVisitorPerHour,
              activePerOwner: LIMITS.activePerOwner,
              staleMs: STALE_EXAMINATION_MS,
            },
      });
      if ("over" in created) throw new LimitError(refusalOf(created));
      const { examinationId } = created;
      try {
        const runId = await ports.runs.start(examinationId);
        await examinations.update(examinationId, { workflow_run_id: runId });
      } catch (error) {
        console.error("[loupe] workflow start failed", error);
        const message = "The Examination could not be started. Try again.";
        if (
          await examinations.endIfGoing(examinationId, {
            status: "failed",
            error: message,
          })
        )
          await shared
            .emit(examinationId, {
              type: "end",
              status: "failed",
              error: message,
            })
            .catch(() => {});
        throw new ConflictError(message);
      }
      return { examinationId };
    },

    async stop(who, examinationId) {
      const row = await examinations.owned(who.owner, examinationId);
      if (!row) throw new NotFoundError("No such Examination.");
      if (isOver(row.status))
        return { examinationId: row.id, stopped: false, status: row.status };
      if (!(await examinations.endIfGoing(row.id, { status: "stopped" }))) {
        const latest = await examinations.pulse(row.id);
        return {
          examinationId: row.id,
          stopped: false,
          status: latest?.status ?? row.status,
        };
      }
      await Promise.all([
        shared
          .emit(
            row.id,
            { type: "log", level: "warn", text: "Stopped by its Owner." },
            { type: "end", status: "stopped" },
          )
          .catch(() => {}),
        ports.audit
          .append(who.owner, "examination.stopped", who.via, {
            examinationId: row.id,
          })
          .catch(() => {}),
      ]);
      if (row.workflow_run_id) {
        try {
          await ports.runs.cancel(row.workflow_run_id, "Stopped by its Owner");
        } catch {
          // Already ended, or the workflow is gone: the row is closed either way.
        }
      }
      await ports.sandbox.dispose(row.id);
      return { examinationId: row.id, stopped: true, status: "stopped" };
    },

    async reevaluate(who, examinationId) {
      const row = await examinations.owned(who.owner, examinationId);
      if (!row) throw new NotFoundError("No such Examination.");
      if (row.status !== "completed" || !row.verdict)
        throw new ConflictError(
          "Only a completed Examination can be re-evaluated.",
        );
      const [, current] = await Promise.all([
        ports.rate.take("reevaluate", who.visitor, { owner: who.owner }),
        rulebooks.current(who.owner),
      ]);
      const next = { ...row, rulebook: current.rulebook };
      const standing = standingOf(next, row.state);
      const score = await ending.scoreOf(next, standing);
      await examinations.update(row.id, {
        findings: standing.findings,
        verdict: standing.verdict,
        gate: standing.gate,
        score,
        rulebook: current.rulebook,
        rulebook_version: current.version,
      });
      const result: Reevaluated = {
        examinationId: row.id,
        fromVersion: row.rulebook_version,
        toVersion: current.version,
        from: row.verdict.verdict,
        to: standing.verdict.verdict,
        findings: standing.findings.filter((f) => f.weight !== "context")
          .length,
      };
      await Promise.all([
        shared.emit(
          row.id,
          {
            type: "reevaluated",
            fromVersion: result.fromVersion,
            toVersion: result.toVersion,
            from: result.from,
            to: result.to,
          },
          {
            type: "findings",
            findings: standing.findings,
            verdict: standing.verdict,
            rulebookVersion: current.version,
          },
        ),
        ports.audit
          .append(who.owner, "examination.reevaluated", who.via, {
            examinationId: row.id,
            fromVersion: result.fromVersion,
            toVersion: result.toVersion,
            from: result.from,
            to: result.to,
          })
          .catch(() => {}),
      ]);
      return result;
    },

    audit: (owner) => ports.audit.list(owner),

    corpus() {
      corpus ??= { entries: MANIFEST, sweeps: [...RECORDED.values()] };
      return corpus;
    },

    async firstView(owner) {
      const [list, versions] = await Promise.all([
        examinations.list(owner),
        rulebooks.list(owner),
      ]);
      return { examinations: list, rulebooks: versions };
    },
  };
}
