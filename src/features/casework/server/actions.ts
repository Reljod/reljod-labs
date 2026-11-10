"use server";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ASK_TOOL, type ChoiceOption } from "../domain/chat-events";
import {
  type ModelSettings,
  modelSettingsSchema,
  PURPOSE_IDS,
  type Purpose,
} from "../domain/model-config";
import { type Answer, answerSchema } from "../domain/run-events";
import type { SourceFormat } from "../domain/run-state";
import type { DeskSummary, DeskView, DocView, SpendView } from "../view";
import { env } from "./env";
import {
  type CaseFileRow,
  countUploads,
  type DocumentRow,
  documentsByIds,
  insertUpload,
  loadCabinetDocuments,
  loadCaseFiles,
  loadMessages,
  runCosts,
  runsForSession,
  type SessionRow,
  sessionSpend,
  sessionsByIds,
  setModelOverrides,
  spendBySession,
} from "./repository";
import { answerQuestion, settingsFor, stopActiveRun, stopRun } from "./runs";
import { deskIds, ensureSession, startSession, switchSession } from "./session";
import { BUCKET, signedUrls, supabase } from "./supabase";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOADS_PER_SESSION = 30;

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

function docView(
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

async function deskList(current: SessionRow): Promise<DeskSummary[]> {
  const sessions = await sessionsByIds(await deskIds());
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

/** Everything the desk shows on load: the Cabinet, the chat so far, runs, spend, settings. */
export async function openDesk(): Promise<DeskView> {
  const session = await ensureSession();
  const [folders, documents, messages, runs, spend, settings, desks] =
    await Promise.all([
      loadCaseFiles(),
      loadCabinetDocuments(session.id),
      loadMessages(session.id, 80),
      runsForSession(session.id),
      spendView(session.id),
      settingsFor(session),
      deskList(session),
    ]);
  const costs = await runCosts(runs.map((run) => run.id));
  const bySlug = new Map(folders.map((folder) => [folder.slug, folder]));
  const urls = await signedUrls(
    documents.flatMap((row) => (row.page_paths[0] ? [row.page_paths[0]] : [])),
    6 * 3600,
  );
  return {
    sessionId: session.id,
    desks,
    folders: folders.map((folder) => ({
      slug: folder.slug,
      title: folder.title,
      scenario: folder.scenario,
      summary: folder.summary,
      split: folder.split,
      documents: documents
        .filter((row) => row.case_file_slug === folder.slug)
        .map((row) => docView(row, urls, bySlug)),
    })),
    uploads: documents
      .filter((row) => row.session_id === session.id)
      .map((row) => docView(row, urls)),
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
    runs: runs.map((run) => ({
      id: run.id,
      pipeline: run.pipeline,
      jobs: run.jobs,
      status: run.status,
      recommendation: run.recommendation,
      createdAt: run.created_at,
      costUsd: costs.get(run.id)?.costUsd ?? 0,
      calls: costs.get(run.id)?.calls ?? 0,
      documentIds: run.document_ids,
    })),
    spend,
    settings,
  };
}

export type DocumentPages = {
  id: string;
  name: string;
  sourceFormat: DocumentRow["source_format"];
  pages: string[];
  csv: string | null;
};

/**
 * Signed page images for several Documents in one call, so a Run's pages can
 * be fetched up front rather than one by one as each is shown.
 */
export async function documentsPages(
  documentIds: string[],
): Promise<Record<string, DocumentPages>> {
  const session = await ensureSession();
  const found = await documentsByIds(documentIds.slice(0, 60), session.id);
  const pathsOf = (row: DocumentRow) =>
    row.page_paths.length ? row.page_paths : [row.storage_path];
  const urls = await signedUrls(
    found.flatMap((row) => (row.source_format === "csv" ? [] : pathsOf(row))),
    3600,
  );
  const entries = await Promise.all(
    found.map(async (row): Promise<[string, DocumentPages]> => {
      let csv: string | null = null;
      if (row.source_format === "csv") {
        const { data } = await supabase()
          .storage.from(BUCKET)
          .download(row.storage_path);
        csv = data ? (await data.text()).slice(0, 20_000) : null;
      }
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
  return Object.fromEntries(entries);
}

export async function getSpend() {
  const session = await ensureSession();
  return spendView(session.id);
}

export async function answer(questionId: string, reply: Answer) {
  const session = await ensureSession();
  return answerQuestion(session, String(questionId), answerSchema.parse(reply));
}

export async function saveModelSettings(
  purpose: Purpose,
  settings: ModelSettings,
) {
  const session = await ensureSession();
  if (!PURPOSE_IDS.includes(purpose)) throw new Error("Unknown purpose");
  const parsed = modelSettingsSchema.parse(settings);
  await setModelOverrides(session.id, {
    ...session.model_overrides,
    [purpose]: parsed,
  });
  return settingsFor({
    ...session,
    model_overrides: { ...session.model_overrides, [purpose]: parsed },
  });
}

export async function resetModelSettings() {
  const session = await ensureSession();
  await setModelOverrides(session.id, {});
  return settingsFor({ ...session, model_overrides: {} });
}

/** A fresh desk: a new session. The old ones stay on the list to go back to. */
export async function newDesk() {
  await startSession();
}

/** Goes back to an earlier desk of this browser. */
export async function openEarlierDesk(id: string) {
  return switchSession(String(id));
}

/** Stops a Run, or whatever this desk has going. */
export async function stop(runId?: string | null) {
  const session = await ensureSession();
  return runId ? stopRun(session, String(runId)) : stopActiveRun(session);
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_PAGES = 12;

type UploadTicket = {
  sessionId: string;
  name: string;
  mediaType: string;
  sourceFormat: SourceFormat;
  storagePath: string;
  pagePaths: string[];
  sizeBytes: number;
};

function sign(payload: string) {
  return createHmac("sha256", env.rateLimitSalt())
    .update(`casework-upload:${payload}`)
    .digest("base64url");
}

function readTicket(ticket: string, sessionId: string): UploadTicket | null {
  const [payload, signature] = String(ticket).split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString(),
  ) as UploadTicket;
  return parsed.sessionId === sessionId ? parsed : null;
}

export type UploadRequest = {
  name: string;
  type: string;
  size: number;
  /** PDFs only: how many page images the browser rendered, and whether it found a text layer. */
  pages: number;
  digital: boolean;
};

export type UploadSlot =
  | { ok: false; name: string; reason: string }
  | {
      ok: true;
      name: string;
      ticket: string;
      fileUrl: string;
      contentType: string;
      pageUrls: string[];
    };

/**
 * Opens slots for files dropped on the desk: one signed Storage URL for each
 * file and each rendered PDF page, so the browser uploads straight to Storage
 * and files of any number and size skip the server's request limit.
 */
export async function beginUpload(
  files: UploadRequest[],
): Promise<UploadSlot[]> {
  const session = await ensureSession();
  const room = MAX_UPLOADS_PER_SESSION - (await countUploads(session.id));
  const slots: UploadSlot[] = [];
  let taken = 0;
  for (const file of files.slice(0, 60)) {
    const name = String(file.name).slice(0, 200);
    const lower = name.toLowerCase();
    const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
    const isCsv = file.type === "text/csv" || lower.endsWith(".csv");
    const isImage = IMAGE_TYPES.has(file.type) || /\.(jpe?g|png)$/.test(lower);
    const sourceFormat: SourceFormat | null = isPdf
      ? file.digital
        ? "pdf_digital"
        : "pdf_scanned"
      : isCsv
        ? "csv"
        : isImage
          ? "image"
          : null;
    if (!sourceFormat) {
      slots.push({ ok: false, name, reason: "only PDF, JPEG, PNG or CSV" });
      continue;
    }
    if (!(file.size > 0) || file.size > MAX_UPLOAD_BYTES) {
      slots.push({ ok: false, name, reason: "over 10 MB" });
      continue;
    }
    if (taken >= room) {
      slots.push({
        ok: false,
        name,
        reason: `a desk holds at most ${MAX_UPLOADS_PER_SESSION} uploads`,
      });
      continue;
    }
    taken++;
    const folder = `uploads/${session.id}/${randomUUID()}`;
    const safeName =
      name
        .normalize("NFD")
        .replace(/[^\w.-]+/g, "-")
        .slice(-80) || "file";
    const storagePath = `${folder}/${safeName}`;
    const pageCount = isPdf
      ? Math.max(0, Math.min(MAX_PAGES, Math.trunc(file.pages)))
      : 0;
    const pagePaths =
      sourceFormat === "image"
        ? [storagePath]
        : Array.from(
            { length: pageCount },
            (_, index) => `${folder}/page-${index + 1}.jpg`,
          );
    const contentType = isPdf
      ? "application/pdf"
      : isCsv
        ? "text/csv"
        : lower.endsWith(".png")
          ? "image/png"
          : "image/jpeg";
    const signedFor = async (path: string) => {
      const { data, error } = await supabase()
        .storage.from(BUCKET)
        .createSignedUploadUrl(path);
      if (error || !data) throw new Error(error?.message ?? "Upload refused");
      return data.signedUrl;
    };
    const [fileUrl, ...pageUrls] = await Promise.all([
      signedFor(storagePath),
      ...(isPdf ? pagePaths.map(signedFor) : []),
    ]);
    const payload = Buffer.from(
      JSON.stringify({
        sessionId: session.id,
        name,
        mediaType: contentType,
        sourceFormat,
        storagePath,
        pagePaths,
        sizeBytes: Math.trunc(file.size),
      } satisfies UploadTicket),
    ).toString("base64url");
    slots.push({
      ok: true,
      name,
      ticket: `${payload}.${sign(payload)}`,
      fileUrl,
      contentType,
      pageUrls,
    });
  }
  return slots;
}

/** Records the files the browser finished uploading as Documents of this desk. */
export async function finishUpload(tickets: string[]): Promise<DocView[]> {
  const session = await ensureSession();
  const valid = tickets
    .slice(0, 60)
    .flatMap((ticket) => readTicket(ticket, session.id) ?? []);
  if (valid.length === 0) return [];
  if (
    (await countUploads(session.id)) + valid.length >
    MAX_UPLOADS_PER_SESSION
  ) {
    throw new Error(`A desk holds at most ${MAX_UPLOADS_PER_SESSION} uploads.`);
  }
  const created: DocumentRow[] = [];
  for (const ticket of valid) {
    created.push(
      await insertUpload({
        sessionId: session.id,
        name: ticket.name,
        mediaType: ticket.mediaType,
        sourceFormat: ticket.sourceFormat,
        storagePath: ticket.storagePath,
        pagePaths: ticket.pagePaths,
        sizeBytes: ticket.sizeBytes,
      }),
    );
  }
  const urls = await signedUrls(
    created.flatMap((row) => (row.page_paths[0] ? [row.page_paths[0]] : [])),
    6 * 3600,
  );
  return created.map((row) => docView(row, urls));
}
