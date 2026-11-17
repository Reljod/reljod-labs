import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  compareNames,
  runPages,
  type Standing,
  standing,
} from "../domain/compare";
import {
  type Comparison,
  DEFAULT_RULEBOOK,
  type DocumentOverview,
  type DocumentSource,
  type DocumentText,
  type ExtractedName,
  type HardReason,
  type OverviewName,
  type PreviewPage,
  type Rulebook,
  rulebookSchema,
} from "../domain/contract";
import {
  answerKeyFor,
  corpusEntry,
  type ExpectedName,
  generateDocumentDetailed,
} from "../domain/corpus";
import {
  keyMarks,
  runMarks,
  type SplitPieces,
  splitPieces,
} from "../domain/marks";
import { isCorpusId, loadDocument } from "./document";
import {
  isOver,
  latestNames,
  ownedRun,
  ownedUpload,
  type RunRow,
} from "./repository";

/** At most this many pages per previewPages call. */
export const MAX_PREVIEW_PAGES = 12;

/** A Corpus Document with its key and its hard-only parties, kept per instance. */
type CorpusDoc = {
  document: DocumentText;
  answerKey: ExpectedName[];
  hard: Map<string, HardReason>;
  pieces: SplitPieces;
};
const corpusCache = new Map<string, CorpusDoc>();
const CORPUS_CACHE_SIZE = 3;

function corpusDoc(corpusId: string): CorpusDoc {
  const hit = corpusCache.get(corpusId);
  if (hit) {
    corpusCache.delete(corpusId);
    corpusCache.set(corpusId, hit);
    return hit;
  }
  const generated = generateDocumentDetailed(corpusId);
  const doc = {
    document: generated.document,
    answerKey: generated.answerKey,
    hard: new Map(
      generated.hard.map((party) => [party.canonical, party.kind] as const),
    ),
    pieces: splitPieces(generated.mentions, generated.answerKey),
  };
  corpusCache.set(corpusId, doc);
  while (corpusCache.size > CORPUS_CACHE_SIZE) {
    const oldest = corpusCache.keys().next().value;
    if (oldest === undefined) break;
    corpusCache.delete(oldest);
  }
  return doc;
}

/** What a preview shows: the Document, its key (demo Documents), the Run's Names (with a Run). */
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
};

/** The Rulebook a Run ran under (stored on its row); the default if the row's is unreadable. */
function rulebookOf(run: RunRow): Rulebook {
  const parsed = rulebookSchema.safeParse(run.rulebook);
  return parsed.success ? parsed.data : DEFAULT_RULEBOOK;
}

/** A Run's Register: the stored one once it is over, else its latest `names` event. */
async function registerOf(run: RunRow): Promise<ExtractedName[]> {
  const stored = Array.isArray(run.names) ? run.names : [];
  if (isOver(run.status) && stored.length > 0) return stored;
  return (await latestNames(run.id)) ?? stored;
}

/**
 * Loads what to preview, Owner-scoped. With a Run, its own source, Rulebook
 * and Register (the `source` argument is ignored); without one, the
 * Document alone, keyed under the default Rulebook.
 */
async function loadTarget(
  owner: Owner,
  requested: DocumentSource | null,
  runId?: string,
): Promise<Target | { error: string }> {
  let source = requested;
  let rulebook: Rulebook = DEFAULT_RULEBOOK;
  let names: ExtractedName[] | null = null;
  let title: string | null = null;
  if (runId !== undefined) {
    const run = await ownedRun(owner, runId);
    if (!run) return { error: "No such Run." };
    source = run.source;
    rulebook = rulebookOf(run);
    names = await registerOf(run);
    title = run.title;
  }
  if (!source) return { error: "Pick a demo document or an upload." };
  if (source.kind === "corpus") {
    if (!isCorpusId(source.corpusId))
      return { error: "No such demo document." };
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
    };
  }
  // A Run's Upload is the Owner's (the Run is); without a Run, check it is.
  if (runId === undefined && !(await ownedUpload(owner, source.uploadId)))
    return { error: "No such upload." };
  try {
    const document = await loadDocument(source);
    return {
      title: title ?? document.title,
      genre: "Upload",
      document,
      expected: null,
      hard: new Map(),
      pieces: new Map(),
      names,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The upload failed.",
    };
  }
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

export async function overview(
  owner: Owner,
  source: DocumentSource | null,
  runId?: string,
): Promise<DocumentOverview | { error: string }> {
  const target = await loadTarget(owner, source, runId);
  if ("error" in target) return target;
  return {
    title: target.title,
    genre: target.genre,
    pages: target.document.pages.length,
    density: density(target),
    names: overviewNames(target),
  };
}

/** Every name with its pages: the key's (standing against the Run, if any) and the Run's extras. */
function overviewNames(target: Target): OverviewName[] {
  const out: OverviewName[] = [];
  const view = target.names ? standing(target.names, target.expected) : null;
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

export async function pages(
  owner: Owner,
  source: DocumentSource | null,
  range: { from: number; to: number },
  runId?: string,
): Promise<{ total: number; pages: PreviewPage[] } | { error: string }> {
  const { from, to } = range;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from)
    return { error: "Ask for pages from 1 up, in order." };
  if (to - from + 1 > MAX_PREVIEW_PAGES)
    return { error: `At most ${MAX_PREVIEW_PAGES} pages at a time.` };
  const target = await loadTarget(owner, source, runId);
  if ("error" in target) return target;
  const total = target.document.pages.length;
  if (from > total) return { error: `The document has ${total} pages.` };
  const last = Math.min(to, total);
  const view: Standing | null = target.names
    ? standing(target.names, target.expected)
    : null;
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
}

export async function comparison(
  owner: Owner,
  runId: string,
): Promise<Comparison | { error: string }> {
  const run = await ownedRun(owner, runId);
  if (!run) return { error: "No such Run." };
  const names = await registerOf(run);
  if (run.source.kind === "upload") return compareNames(names, null);
  if (!isCorpusId(run.source.corpusId))
    return { error: "No such demo document." };
  const doc = corpusDoc(run.source.corpusId);
  return compareNames(
    names,
    answerKeyFor(doc.answerKey, rulebookOf(run)),
    doc.hard,
  );
}
