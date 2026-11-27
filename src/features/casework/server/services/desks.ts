import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { NotFoundError } from "@/platform/errors";
import { MAX_PAGE_IDS } from "../../domain/api";
import { ASK_TOOL, type ChoiceOption } from "../../domain/chat-events";
import {
  type ModelSettings,
  type ModelSettingsByPurpose,
  type Purpose,
  resolveSettings,
} from "../../domain/model-config";
import type {
  DeskStatus,
  DeskSummary,
  DeskView,
  DocumentPages,
  DocView,
  FolderView,
  MessageView,
  RunSummary,
  SpendView,
} from "../../view";
import type {
  CabinetStore,
  Caller,
  CaseworkStorage,
  DeskStore,
  MessageStore,
  RunStore,
  SpendStore,
} from "../ports";
import type {
  CaseFileRow,
  DocumentRow,
  MessageRow,
  SessionRow,
} from "../repository";
import { ownerMatches } from "../session";
import { ttlMap, ttlValue } from "../ttl-cache";

/** How many earlier Desks the list offers to go back to. */
const MAX_DESKS = 12;
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
/** Only the first 20,000 characters of a CSV are ever shown. */
const CSV_CHARS = 20_000;

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

function messageView(message: MessageRow): MessageView {
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
}

/**
 * The Desks of an Owner: which one a request works in, what each shows, its
 * model settings, and the Cabinet's pages. Every method takes the Owner the
 * gate gave and reaches only that Owner's Desks; the id a browser remembers
 * only chooses among them.
 */
export interface DeskService {
  /** The Desk this request works in: the remembered one if it is the Owner's, else their latest. */
  current(
    owner: Owner,
    rememberedId: string | null,
  ): Promise<SessionRow | null>;
  /** `current`, created on first use. */
  ensure(caller: Caller, rememberedId: string | null): Promise<SessionRow>;
  /**
   * Opens a Desk with everything it shows: the one asked for (404 when it is
   * not the Owner's), or else the current one, created on first use.
   */
  open(
    caller: Caller,
    rememberedId: string | null,
    deskId: string | null,
  ): Promise<DeskView>;
  /** A fresh Desk, opened. The old ones stay on the list to go back to. */
  create(caller: Caller): Promise<DeskView>;
  /** Everything a Desk shows on load, for a Desk already checked to be the Owner's. */
  view(owner: Owner, desk: SessionRow): Promise<DeskView>;
  /** What changes while the Desk is open: its Runs, the list of Desks, the Spend. 404 with no Desk. */
  status(owner: Owner, rememberedId: string | null): Promise<DeskStatus>;
  /** Signed pages for Documents the current Desk may use (only the Cabinet's without a Desk). */
  pages(
    owner: Owner,
    rememberedId: string | null,
    documentIds: string[],
  ): Promise<Record<string, DocumentPages>>;
  settings(desk: SessionRow): Promise<ModelSettingsByPurpose>;
  saveSettings(
    desk: SessionRow,
    purpose: Purpose,
    settings: ModelSettings,
  ): Promise<ModelSettingsByPurpose>;
  resetSettings(desk: SessionRow): Promise<ModelSettingsByPurpose>;
  spend(deskId: string): Promise<SpendView>;
  /** The Desk a session token names, while it still belongs to the token's Owner. */
  forToken(deskId: string, owner: Owner | null): Promise<SessionRow>;
  /** The outside MCP client's one shared Desk. */
  external(): Promise<string>;
  /** Cabinet and upload Documents whose folder or name match the words. */
  find(
    desk: SessionRow,
    query: string,
  ): Promise<{ id: string; name: string; folder: string }[]>;
}

export type DeskPorts = {
  desks: DeskStore;
  cabinet: CabinetStore;
  runs: Pick<RunStore, "withCosts">;
  messages: Pick<MessageStore, "recent">;
  spend: Pick<SpendStore, "ofDesk" | "byDesk">;
  storage: CaseworkStorage;
};

export function createDeskService(ports: DeskPorts): DeskService {
  const { desks, cabinet, storage } = ports;

  const thumbUrls = (rows: DocumentRow[]) =>
    storage.signedUrls(
      rows.flatMap((row) => (row.page_paths[0] ? [row.page_paths[0]] : [])),
      THUMB_TTL_S,
    );

  /** The Case files with their Documents and thumbnails: shared, cached. */
  const seedCabinet = ttlValue(
    SEED_CACHE_MS,
    async (): Promise<FolderView[]> => {
      const [folders, documents] = await Promise.all([
        cabinet.caseFiles(),
        cabinet.seedDocuments(),
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
    },
  );

  /** Seed Documents' page images, signed as long as thumbnails and cached the same way. */
  const seedPageUrls = ttlMap(SEED_CACHE_MS, (paths) =>
    storage.signedUrls(paths, THUMB_TTL_S),
  );

  /** Seed CSVs, read once. */
  const seedCsv = ttlMap(SEED_CACHE_MS, async (paths) => {
    const texts = await Promise.all(
      paths.map((path) => storage.text(path, CSV_CHARS)),
    );
    return new Map(
      paths.flatMap((path, index) => {
        const text = texts[index];
        return text === null || text === undefined
          ? []
          : [[path, text] as [string, string]];
      }),
    );
  });

  async function deskList(
    owner: Owner,
    current: SessionRow,
  ): Promise<DeskSummary[]> {
    const owned = await desks.listWithSpend(owner, MAX_DESKS);
    // The open Desk is listed even when it is older than the last twelve.
    const listed = owned.some((desk) => desk.id === current.id)
      ? owned
      : [
          {
            ...current,
            spend_usd:
              (await ports.spend.byDesk([current.id])).get(current.id) ?? 0,
          },
          ...owned,
        ];
    return listed
      .filter((desk) => desk.id === current.id || desk.title)
      .map((desk) => ({
        id: desk.id,
        title: desk.title ?? "New desk",
        lastActiveAt: desk.last_active_at,
        spendUsd: Number(desk.spend_usd),
        current: desk.id === current.id,
      }));
  }

  async function spend(deskId: string): Promise<SpendView> {
    const rows = await ports.spend.ofDesk(deskId);
    return {
      totalUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
      rows,
    };
  }

  async function runSummaries(deskId: string): Promise<RunSummary[]> {
    const runs = await ports.runs.withCosts(deskId);
    return runs.map((run) => ({
      id: run.id,
      pipeline: run.pipeline,
      jobs: run.jobs,
      status: run.status,
      recommendation: run.recommendation,
      createdAt: run.created_at,
      costUsd: Number(run.cost_usd),
      calls: run.calls,
      documentIds: run.document_ids,
    }));
  }

  async function uploadViews(deskId: string) {
    const rows = await cabinet.uploadsOf(deskId);
    const urls = await thumbUrls(rows);
    return rows.map((row) => docView(row, urls));
  }

  async function settings(desk: SessionRow) {
    const org = await desks.orgModelSettings().catch(() => ({}));
    return resolveSettings(org, desk.model_overrides ?? {});
  }

  async function view(owner: Owner, desk: SessionRow): Promise<DeskView> {
    // Every independent read starts at once; the Case files come from the cache.
    const [folders, uploads, messages, runs, spent, resolved, list] =
      await Promise.all([
        seedCabinet(),
        uploadViews(desk.id),
        ports.messages.recent(desk.id, 80),
        runSummaries(desk.id),
        spend(desk.id),
        settings(desk),
        deskList(owner, desk),
      ]);
    return {
      sessionId: desk.id,
      desks: list,
      folders,
      uploads,
      messages: messages.map(messageView),
      runs,
      spend: spent,
      settings: resolved,
    };
  }

  async function createFor(caller: Caller) {
    const id = await desks.create(caller.visitor.hash, caller.owner);
    const created = await desks.get(id);
    if (!created) throw new Error("Session was not created");
    return created;
  }

  async function ensure(caller: Caller, rememberedId: string | null) {
    return (
      (await desks.openOf(caller.owner, rememberedId)) ??
      (await createFor(caller))
    );
  }

  return {
    current: (owner, rememberedId) => desks.openOf(owner, rememberedId),
    ensure,

    async open(caller, rememberedId, deskId) {
      if (deskId) {
        const desk = await desks.get(deskId);
        if (!desk || desk.owner !== caller.owner)
          throw new NotFoundError("That desk is not yours to open.");
        return view(caller.owner, desk);
      }
      return view(caller.owner, await ensure(caller, rememberedId));
    },

    async create(caller) {
      return view(caller.owner, await createFor(caller));
    },

    view,

    async status(owner, rememberedId) {
      const desk = await desks.openOf(owner, rememberedId);
      if (!desk) throw new NotFoundError("No desk is open.");
      const [runs, list, spent] = await Promise.all([
        runSummaries(desk.id),
        deskList(owner, desk),
        spend(desk.id),
      ]);
      return { sessionId: desk.id, runs, desks: list, spend: spent };
    },

    async pages(owner, rememberedId, documentIds) {
      const desk = await desks.openOf(owner, rememberedId);
      const deskId = desk?.id ?? null;
      // Without a Desk only the Cabinet's: an upload is never reachable by a null Desk.
      const found = (
        await cabinet.byIds(documentIds.slice(0, MAX_PAGE_IDS), deskId)
      ).filter(
        (row) =>
          row.case_file_slug || (deskId !== null && row.session_id === deskId),
      );
      const pathsOf = (row: DocumentRow) =>
        row.page_paths.length ? row.page_paths : [row.storage_path];
      const images = found.filter((row) => row.source_format !== "csv");
      const csvs = found.filter((row) => row.source_format === "csv");
      const seedImages = images.filter((row) => row.case_file_slug);
      const uploadImages = images.filter((row) => !row.case_file_slug);
      const [seedUrls, uploadUrls, seedTexts, uploadTexts] = await Promise.all([
        seedPageUrls(seedImages.flatMap(pathsOf)),
        storage.signedUrls(uploadImages.flatMap(pathsOf), UPLOAD_PAGE_TTL_S),
        seedCsv(
          csvs.flatMap((row) => (row.case_file_slug ? [row.storage_path] : [])),
        ),
        Promise.all(
          csvs.flatMap((row) =>
            row.case_file_slug
              ? []
              : [
                  storage
                    .text(row.storage_path, CSV_CHARS)
                    .then((text) => [row.id, text] as const),
                ],
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
    },

    settings,

    async saveSettings(desk, purpose, chosen) {
      const overrides = { ...desk.model_overrides, [purpose]: chosen };
      await desks.setModelOverrides(desk.id, overrides);
      return settings({ ...desk, model_overrides: overrides });
    },

    async resetSettings(desk) {
      await desks.setModelOverrides(desk.id, {});
      return settings({ ...desk, model_overrides: {} });
    },

    spend,

    async forToken(deskId, owner) {
      const desk = await desks.get(deskId);
      if (!desk) throw new NotFoundError("Session expired");
      if (!ownerMatches(desk.owner, owner))
        throw new NotFoundError("Not authorised");
      return desk;
    },

    external: () => desks.external(),

    async find(desk, query) {
      const [folders, documents] = await Promise.all([
        cabinet.caseFiles(),
        cabinet.cabinetOf(desk.id),
      ]);
      const bySlug = new Map(folders.map((folder) => [folder.slug, folder]));
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      return documents
        .map((document) => {
          const folder = document.case_file_slug
            ? bySlug.get(document.case_file_slug)
            : undefined;
          const haystack =
            `${folder?.title ?? "uploads"} ${folder?.slug ?? ""} ${document.name}`.toLowerCase();
          return {
            document,
            folder,
            score: words.filter((word) => haystack.includes(word)).length,
          };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map(({ document, folder }) => ({
          id: document.id,
          name: document.name,
          folder: folder?.title ?? "Uploads",
        }));
    },
  };
}
