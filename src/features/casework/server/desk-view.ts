import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { Owner } from "@/features/access/domain/owner";
import { AccessDeniedError } from "@/features/access/server/gate";
import { MAX_PAGE_IDS } from "../domain/api";
import { ASK_TOOL, type ChoiceOption } from "../domain/chat-events";
import type {
  DeskStatus,
  DeskSummary,
  DeskView,
  DocumentPages,
  DocView,
  FolderView,
  RunSummary,
  SpendView,
} from "../view";
import {
  type CaseFileRow,
  type DocumentRow,
  documentsByIds,
  loadCaseFiles,
  loadMessages,
  loadSeedDocuments,
  loadUploads,
  type RunRow,
  runCosts,
  runsForSession,
  type SessionRow,
  sessionSpend,
  spendBySession,
} from "./repository";
import { settingsFor } from "./runs";
import { currentDesk, ownedDesks } from "./session";
import { BUCKET, signedUrls, supabase } from "./supabase";
import { ttlMap, ttlValue } from "./ttl-cache";

/** Signed thumbnails of the Cabinet live this long, as they always have. */
const THUMB_TTL_S = 6 * 3600;
/** Pages of an upload: signed per request, for an hour. */
const UPLOAD_PAGE_TTL_S = 3600;
/**
 * The Case files and their Documents are shared seed data, the same for every
 * Owner, so one server instance reads and signs them once and reuses them.
 * Kept well inside the signatures' lifetime: a URL handed out from the cache
 * still has at least `THUMB_TTL_S - SEED_CACHE_MS` to live, more than the
 * 50 minutes the browser keeps it.
 */
const SEED_CACHE_MS = 30 * 60 * 1000;

/** Label fields that name who a Document is about (not who certified, paid or wrote it). */
const ENTITY_FIELDS = [
  "full_name",
  "member_name",
  "customer_name",
  "person_name",
  "subject_name",
  "account_holder",
  "entity_name",
  "employer_name",
  "licensee_name",
  "top_entity",
  "trust_name",
];

function entitiesOf(label: DocumentRow["label"]) {
  if (!label) return [];
  const names = ENTITY_FIELDS.flatMap((field) => {
    const value = label[field];
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  });
  // The same person is often written two ways; keep the first spelling of each.
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function docView(
  row: DocumentRow,
  urls: Map<string, string>,
  folders?: Map<string, CaseFileRow>,
): DocView {
  const thumb = row.page_paths[0];
  return {
    id: row.id,
    name: row.name,
    sourceFormat: row.source_format,
    pageCount: Math.max(1, row.page_paths.length),
    thumbUrl: thumb ? (urls.get(thumb) ?? null) : null,
    sizeBytes: row.size_bytes,
    kind: row.label_kind,
    entities: entitiesOf(row.label),
    folder: row.case_file_slug
      ? (folders?.get(row.case_file_slug)?.title ?? null)
      : null,
  };
}

/** Signed thumbnails for Documents, by their first page. */
export async function thumbUrls(rows: DocumentRow[]) {
  return signedUrls(
    rows.flatMap((row) => (row.page_paths[0] ? [row.page_paths[0]] : [])),
    THUMB_TTL_S,
  );
}

/** The Case files with their Documents and thumbnails: shared, cached. */
const seedCabinet = ttlValue(SEED_CACHE_MS, async (): Promise<FolderView[]> => {
  const [folders, documents] = await Promise.all([
    loadCaseFiles(),
    loadSeedDocuments(),
  ]);
  const bySlug = new Map(folders.map((folder) => [folder.slug, folder]));
  const urls = await thumbUrls(documents);
  return folders.map((folder) => ({
    slug: folder.slug,
    title: folder.title,
    scenario: folder.scenario,
    summary: folder.summary,
    split: folder.split,
    documents: documents
      .filter((row) => row.case_file_slug === folder.slug)
      .map((row) => docView(row, urls, bySlug)),
  }));
});

/** Seed Documents' page images, signed as long as thumbnails and cached the same way. */
const seedPageUrls = ttlMap(SEED_CACHE_MS, (paths) =>
  signedUrls(paths, THUMB_TTL_S),
);

/** Seed CSVs, read once. Only the first 20,000 characters are ever shown. */
const seedCsv = ttlMap(SEED_CACHE_MS, async (paths) => {
  const texts = await Promise.all(paths.map(csvText));
  return new Map(
    paths.flatMap((path, index) => {
      const text = texts[index];
      return text === null ? [] : [[path, text] as [string, string]];
    }),
  );
});

async function csvText(path: string) {
  const { data } = await supabase().storage.from(BUCKET).download(path);
  return data ? (await data.text()).slice(0, 20_000) : null;
}

async function deskList(
  owner: Owner,
  current: SessionRow,
): Promise<DeskSummary[]> {
  const owned = await ownedDesks(owner);
  const sessions = owned.some((session) => session.id === current.id)
    ? owned
    : [current, ...owned];
  const spend = await spendBySession(sessions.map((session) => session.id));
  return sessions
    .filter((session) => session.id === current.id || session.title)
    .map((session) => ({
      id: session.id,
      title: session.title ?? "New desk",
      lastActiveAt: session.last_active_at,
      spendUsd: spend.get(session.id) ?? 0,
      current: session.id === current.id,
    }));
}

async function spendView(sessionId: string): Promise<SpendView> {
  const rows = await sessionSpend(sessionId);
  return {
    totalUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
    rows,
  };
}

async function runSummaries(sessionId: string): Promise<RunSummary[]> {
  const runs: RunRow[] = await runsForSession(sessionId);
  const costs = await runCosts(runs.map((run) => run.id));
  return runs.map((run) => ({
    id: run.id,
    pipeline: run.pipeline,
    jobs: run.jobs,
    status: run.status,
    recommendation: run.recommendation,
    createdAt: run.created_at,
    costUsd: costs.get(run.id)?.costUsd ?? 0,
    calls: costs.get(run.id)?.calls ?? 0,
    documentIds: run.document_ids,
  }));
}

async function uploadViews(sessionId: string) {
  const rows = await loadUploads(sessionId);
  const urls = await thumbUrls(rows);
  return rows.map((row) => docView(row, urls));
}

/**
 * Everything the desk shows on load, for a Desk the caller already checked
 * belongs to `owner`. Every independent read starts at once; the Cabinet's
 * shared Case files come from the cache.
 */
export async function deskView(
  owner: Owner,
  session: SessionRow,
): Promise<DeskView> {
  const [folders, uploads, messages, runs, spend, settings, desks] =
    await Promise.all([
      seedCabinet(),
      uploadViews(session.id),
      loadMessages(session.id, 80),
      runSummaries(session.id),
      spendView(session.id),
      settingsFor(session),
      deskList(owner, session),
    ]);
  return {
    sessionId: session.id,
    desks,
    folders,
    uploads,
    messages: messages.map((message) => {
      const asked = message.tool_calls.find((call) => call.name === ASK_TOOL)
        ?.input as { question?: string; options?: ChoiceOption[] } | undefined;
      return {
        id: message.id,
        role: message.role,
        text: message.text,
        documentIds: message.document_ids,
        runId: message.run_id,
        tools: message.tool_calls
          .filter((call) => call.name !== ASK_TOOL)
          .map((call) => ({
            name: call.name,
            ok: call.ok !== false,
            summary: call.summary,
          })),
        choices:
          asked?.question && Array.isArray(asked.options)
            ? { question: asked.question, options: asked.options }
            : null,
      };
    }),
    runs,
    spend,
    settings,
  };
}

/** What changes while the desk is open: its Runs, the list of Desks, the Spend. */
export async function deskStatus(
  owner: Owner,
  session: SessionRow,
): Promise<DeskStatus> {
  const [runs, desks, spend] = await Promise.all([
    runSummaries(session.id),
    deskList(owner, session),
    spendView(session.id),
  ]);
  return { sessionId: session.id, runs, desks, spend };
}

/**
 * Signed page images (or the text of a CSV) for Documents this session may
 * use: the Cabinet's, or its own uploads. Seed Documents come signed from the
 * cache; uploads are signed for this request only.
 */
export async function documentPages(
  documentIds: string[],
  sessionId: string | null,
): Promise<Record<string, DocumentPages>> {
  // Without a Desk only the Cabinet's: an upload is never reachable by a null session.
  const found = (
    await documentsByIds(documentIds.slice(0, MAX_PAGE_IDS), sessionId)
  ).filter(
    (row) =>
      row.case_file_slug ||
      (sessionId !== null && row.session_id === sessionId),
  );
  const pathsOf = (row: DocumentRow) =>
    row.page_paths.length ? row.page_paths : [row.storage_path];
  const images = found.filter((row) => row.source_format !== "csv");
  const csvs = found.filter((row) => row.source_format === "csv");
  const seedImages = images.filter((row) => row.case_file_slug);
  const uploadImages = images.filter((row) => !row.case_file_slug);
  const [seedUrls, uploadUrls, seedTexts, uploadTexts] = await Promise.all([
    seedPageUrls(seedImages.flatMap(pathsOf)),
    signedUrls(uploadImages.flatMap(pathsOf), UPLOAD_PAGE_TTL_S),
    seedCsv(
      csvs.flatMap((row) => (row.case_file_slug ? [row.storage_path] : [])),
    ),
    Promise.all(
      csvs.flatMap((row) =>
        row.case_file_slug
          ? []
          : [csvText(row.storage_path).then((text) => [row.id, text] as const)],
      ),
    ).then((pairs) => new Map(pairs)),
  ]);
  return Object.fromEntries(
    found.map((row): [string, DocumentPages] => {
      const urls = row.case_file_slug ? seedUrls : uploadUrls;
      const csv =
        row.source_format === "csv"
          ? ((row.case_file_slug
              ? seedTexts.get(row.storage_path)
              : uploadTexts.get(row.id)) ?? null)
          : null;
      return [
        row.id,
        {
          id: row.id,
          name: row.name,
          sourceFormat: row.source_format,
          pages:
            row.source_format === "csv"
              ? []
              : pathsOf(row).map((path) => urls.get(path) ?? ""),
          csv,
        },
      ];
    }),
  );
}

/**
 * The first view for the page's server render, so the desk paints with its
 * data and makes no request on load. Null when the Owner has no Desk yet
 * (creating one is a write, left to the `openDesk` action), when the gate
 * refuses (the action reports that) or when a read fails (the action retries).
 */
export async function initialDeskView(): Promise<DeskView | null> {
  try {
    const { owner, session } = await currentDesk();
    return session ? await deskView(owner, session) : null;
  } catch (error) {
    unstable_rethrow(error);
    if (!(error instanceof AccessDeniedError))
      console.error("[casework] first view", error);
    return null;
  }
}
