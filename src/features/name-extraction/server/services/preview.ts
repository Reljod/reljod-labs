import type { Owner } from "@/features/access/domain/owner";
import { InvalidError, NotFoundError } from "@/platform/errors";
import type { PagesResponse, PreviewQuery } from "../../domain/api";
import {
  compareNames,
  runPages,
  type Standing,
  standing,
} from "../../domain/compare";
import {
  type Comparison,
  DEFAULT_RULEBOOK,
  type DocumentOverview,
  type DocumentText,
  type ExtractedName,
  type HardReason,
  type OverviewName,
  type PreviewPage,
  type Rulebook,
  rulebookSchema,
} from "../../domain/contract";
import {
  answerKeyFor,
  CORPUS,
  corpusEntry,
  type ExpectedName,
  generateDocumentDetailed,
} from "../../domain/corpus";
import { LIMITS } from "../../domain/limits";
import {
  keyMarks,
  runMarks,
  type SplitPieces,
  splitPieces,
} from "../../domain/marks";
import type { SievePorts } from "../ports";
import { isOver, type RunRow } from "../run-row";

/**
 * The Document preview: a Document's names per page and its pages with
 * marks, before a Run (against the Answer key under the Owner's current
 * Rulebook) or for a Run (its own Document, Rulebook and Register), and a
 * Run set against the key. Owner-scoped: another Owner's Run or Upload is a
 * 404. The 500-page preview reads `LIMITS.previewPages` pages at a time.
 */
export interface PreviewService {
  overview(owner: Owner, query: PreviewQuery): Promise<DocumentOverview>;
  pages(
    owner: Owner,
    query: PreviewQuery & { from: number; to: number },
  ): Promise<PagesResponse>;
  comparison(owner: Owner, runId: string): Promise<Comparison>;
}

/** A Corpus Document with its key and its hard-only parties. */
type CorpusDoc = {
  document: DocumentText;
  answerKey: ExpectedName[];
  hard: Map<string, HardReason>;
  pieces: SplitPieces;
};

/** What a preview shows: the Document, its key (Corpus Documents), the Run's Names (with a Run). */
type Target = {
  title: string;
  genre: string;
  document: DocumentText;
  /** The key the Run is scored against (under the Run's Rulebook); null for an Upload. */
  expected: ExpectedName[] | null;
  hard: ReadonlyMap<string, HardReason>;
  pieces: SplitPieces;
  /** The Run's Register; null without a Run. */
  names: ExtractedName[] | null;
  /** What the Run's standing is cached under; null without a Run. */
  runKey: string | null;
};

/** A small LRU map: the oldest entry goes past `size`. */
function lru<V>(size: number) {
  const entries = new Map<string, V>();
  return {
    get(key: string) {
      const hit = entries.get(key);
      if (hit !== undefined) {
        entries.delete(key);
        entries.set(key, hit);
      }
      return hit;
    },
    set(key: string, value: V) {
      entries.set(key, value);
      while (entries.size > size) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return value;
    },
  };
}

/** A short fingerprint of a string (FNV-1a, 32 bits) with its length. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

const isCorpusId = (id: string) => CORPUS.some((entry) => entry.id === id);

/** The Rulebook a Run ran under (stored on its row); the default if the row's is unreadable. */
function rulebookOf(run: RunRow): Rulebook {
  const parsed = rulebookSchema.safeParse(run.rulebook);
  return parsed.success ? parsed.data : DEFAULT_RULEBOOK;
}

/** The cache key of a Run's standing: same key, same Register and key. */
function runKeyOf(
  owner: Owner,
  run: RunRow,
  names: ExtractedName[],
  rulebook: Rulebook,
): string {
  const settled =
    isOver(run.status) && run.ended_at
      ? `over:${run.ended_at}`
      : `live:${fingerprint(JSON.stringify(names))}`;
  return `${owner}\u0000${run.id}\u0000${settled}\u0000${fingerprint(JSON.stringify(rulebook))}`;
}

/** Names per page, index 0 = page 1: the Run's when there is one, else the key's. */
function density(target: Target): number[] {
  const counts = new Array<number>(target.document.pages.length).fill(0);
  const bump = (page: number) => {
    if (page >= 1 && page <= counts.length) counts[page - 1]++;
  };
  if (target.names)
    for (const name of target.names)
      for (const page of new Set(name.mentions.map((m) => m.page))) bump(page);
  else if (target.expected)
    for (const name of target.expected)
      for (const page of name.pages) bump(page);
  return counts;
}

export function createPreviewService(
  ports: Pick<
    SievePorts,
    "runs" | "events" | "rulebooks" | "uploads" | "loadDocument"
  >,
): PreviewService {
  // Kept per instance: regenerating a 500-page Corpus Document, or matching
  // a 500-page Run's Register against its key, takes tens of milliseconds,
  // and scrolling its preview asks for pages many times over.
  const corpusDocs = lru<CorpusDoc>(3);
  /**
   * A Run's standing against its key, keyed by the Run and what it was
   * matched on (a Run that is over by when it ended; a live one by its
   * Register), so a Run whose Register moved is matched again.
   */
  const standings = lru<Standing>(8);

  function corpusDoc(corpusId: string): CorpusDoc {
    const hit = corpusDocs.get(corpusId);
    if (hit) return hit;
    const generated = generateDocumentDetailed(corpusId);
    return corpusDocs.set(corpusId, {
      document: generated.document,
      answerKey: generated.answerKey,
      hard: new Map(
        generated.hard.map((party) => [party.canonical, party.kind] as const),
      ),
      pieces: splitPieces(generated.mentions, generated.answerKey),
    });
  }

  function cachedStanding(target: Target): Standing | null {
    if (!target.names) return null;
    const key = target.runKey;
    const hit = key ? standings.get(key) : undefined;
    if (hit) return hit;
    const view = standing(target.names, target.expected);
    return key ? standings.set(key, view) : view;
  }

  /** A Run's Register: the stored one once it is over, else its latest `names` event. */
  async function registerOf(run: RunRow): Promise<ExtractedName[]> {
    const stored = Array.isArray(run.names) ? run.names : [];
    if (isOver(run.status) && stored.length > 0) return stored;
    return (await ports.events.latestNames(run.id)) ?? stored;
  }

  /** The Owner's current Rulebook; the default when it cannot be read (the preview still works). */
  async function currentRulebookOrDefault(owner: Owner): Promise<Rulebook> {
    try {
      return (await ports.rulebooks.current(owner)).rulebook;
    } catch {
      return DEFAULT_RULEBOOK;
    }
  }

  async function ownedRun(owner: Owner, runId: string) {
    const run = await ports.runs.owned(owner, runId);
    if (!run) throw new NotFoundError("No such Run.");
    return run;
  }

  /**
   * Loads what to preview, Owner-scoped. With a Run, its own source, Rulebook
   * and Register (the query's source is ignored); without one, the Document
   * alone, keyed under the Owner's current Rulebook.
   */
  async function loadTarget(
    owner: Owner,
    { source: requested, runId }: PreviewQuery,
  ): Promise<Target> {
    let source = requested;
    let rulebook: Rulebook = DEFAULT_RULEBOOK;
    let names: ExtractedName[] | null = null;
    let title: string | null = null;
    let runKey: string | null = null;
    if (runId !== undefined) {
      const run = await ownedRun(owner, runId);
      source = run.source;
      rulebook = rulebookOf(run);
      names = await registerOf(run);
      title = run.title;
      runKey = runKeyOf(owner, run, names, rulebook);
    }
    if (!source) throw new InvalidError("Pick a demo document or an upload.");
    if (source.kind === "corpus") {
      if (!isCorpusId(source.corpusId))
        throw new NotFoundError("No such demo document.");
      if (runId === undefined) rulebook = await currentRulebookOrDefault(owner);
      const entry = corpusEntry(source.corpusId);
      const doc = corpusDoc(source.corpusId);
      return {
        title: entry.title,
        genre: entry.genre,
        document: doc.document,
        expected: answerKeyFor(doc.answerKey, rulebook),
        hard: doc.hard,
        pieces: doc.pieces,
        names,
        runKey,
      };
    }
    // A Run's Upload is the Owner's (the Run is); without a Run, check it is.
    if (
      runId === undefined &&
      !(await ports.uploads.owned(owner, source.uploadId))
    )
      throw new NotFoundError("No such upload.");
    let document: DocumentText;
    try {
      document = await ports.loadDocument(source);
    } catch (error) {
      throw new InvalidError(
        error instanceof Error ? error.message : "The upload failed.",
      );
    }
    return {
      title: title ?? document.title,
      genre: "Upload",
      document,
      expected: null,
      hard: new Map(),
      pieces: new Map(),
      names,
      runKey,
    };
  }

  /** Every name with its pages: the key's (standing against the Run, if any) and the Run's extras. */
  function overviewNames(target: Target): OverviewName[] {
    const out: OverviewName[] = [];
    const view = cachedStanding(target);
    if (target.expected)
      for (const name of target.expected)
        out.push({
          name: name.canonical,
          type: name.type,
          pages: [...name.pages].sort((a, b) => a - b),
          status: view ? view.expected(name) : "expected",
        });
    if (target.names && view)
      for (const name of target.names) {
        const label = view.found(name);
        if (target.expected && label.status !== "extra") continue;
        out.push({
          name: label.name,
          type: name.type,
          pages: runPages(name),
          status: label.status,
        });
      }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    async overview(owner, query) {
      const target = await loadTarget(owner, query);
      return {
        title: target.title,
        genre: target.genre,
        pages: target.document.pages.length,
        density: density(target),
        names: overviewNames(target),
      };
    },

    async pages(owner, { from, to, ...query }) {
      if (to < from)
        throw new InvalidError("Ask for pages from 1 up, in order.");
      if (to - from + 1 > LIMITS.previewPages)
        throw new InvalidError(
          `At most ${LIMITS.previewPages} pages at a time.`,
        );
      const target = await loadTarget(owner, query);
      const total = target.document.pages.length;
      if (from > total)
        throw new InvalidError(`The document has ${total} pages.`);
      const last = Math.min(to, total);
      const view = cachedStanding(target);
      const out: PreviewPage[] = [];
      for (let page = from; page <= last; page++) {
        const text = target.document.pages[page - 1];
        out.push({
          page,
          text,
          key: target.expected
            ? keyMarks(
                page,
                text,
                target.expected,
                view ? view.expected : () => "expected",
                target.pieces,
              )
            : null,
          run:
            view && target.names
              ? runMarks(page, text, target.names, view.found)
              : null,
        });
      }
      return { total, pages: out };
    },

    async comparison(owner, runId) {
      const run = await ownedRun(owner, runId);
      const names = await registerOf(run);
      if (run.source.kind === "upload") return compareNames(names, null);
      if (!isCorpusId(run.source.corpusId))
        throw new NotFoundError("No such demo document.");
      const doc = corpusDoc(run.source.corpusId);
      return compareNames(
        names,
        answerKeyFor(doc.answerKey, rulebookOf(run)),
        doc.hard,
      );
    },
  };
}
