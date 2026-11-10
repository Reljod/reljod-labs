"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import {
  type ModelSettings,
  modelSettingsSchema,
  PURPOSE_IDS,
  type Purpose,
} from "../domain/model-config";
import { type Answer, answerSchema } from "../domain/run-events";
import type { SourceFormat } from "../domain/run-state";
import type { DeskView, DocView, SpendView } from "../view";
import {
  countUploads,
  type DocumentRow,
  documentsByIds,
  insertUpload,
  loadCabinetDocuments,
  loadCaseFiles,
  loadMessages,
  runsForSession,
  sessionSpend,
  setModelOverrides,
} from "./repository";
import { answerQuestion, settingsFor } from "./runs";
import { ensureSession, SESSION_COOKIE } from "./session";
import { BUCKET, signedUrls, supabase } from "./supabase";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOADS_PER_SESSION = 30;

function docView(row: DocumentRow, urls: Map<string, string>): DocView {
  const thumb = row.page_paths[0];
  return {
    id: row.id,
    name: row.name,
    sourceFormat: row.source_format,
    pageCount: Math.max(1, row.page_paths.length),
    thumbUrl: thumb ? (urls.get(thumb) ?? null) : null,
  };
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
  const [folders, documents, messages, runs, spend, settings] =
    await Promise.all([
      loadCaseFiles(),
      loadCabinetDocuments(session.id),
      loadMessages(session.id),
      runsForSession(session.id),
      spendView(session.id),
      settingsFor(session),
    ]);
  const urls = await signedUrls(
    documents.flatMap((row) => (row.page_paths[0] ? [row.page_paths[0]] : [])),
    6 * 3600,
  );
  return {
    sessionId: session.id,
    folders: folders.map((folder) => ({
      slug: folder.slug,
      title: folder.title,
      scenario: folder.scenario,
      summary: folder.summary,
      split: folder.split,
      documents: documents
        .filter((row) => row.case_file_slug === folder.slug)
        .map((row) => docView(row, urls)),
    })),
    uploads: documents
      .filter((row) => row.session_id === session.id)
      .map((row) => docView(row, urls)),
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      documentIds: message.document_ids,
      runId: message.run_id,
      tools: message.tool_calls.map((call) => call.name),
    })),
    runs: runs.map((run) => ({
      id: run.id,
      pipeline: run.pipeline,
      jobs: run.jobs,
      status: run.status,
      recommendation: run.recommendation,
      createdAt: run.created_at,
    })),
    spend,
    settings,
  };
}

/** Signed page images for one Document, for the viewer. */
export async function documentPages(documentId: string) {
  const session = await ensureSession();
  const [row] = await documentsByIds([documentId], session.id);
  if (!row) return null;
  const paths = row.page_paths.length ? row.page_paths : [row.storage_path];
  const urls = await signedUrls(paths, 3600);
  let csv: string | null = null;
  if (row.source_format === "csv") {
    const { data } = await supabase()
      .storage.from(BUCKET)
      .download(row.storage_path);
    csv = data ? (await data.text()).slice(0, 20_000) : null;
  }
  return {
    id: row.id,
    name: row.name,
    sourceFormat: row.source_format,
    pages:
      row.source_format === "csv"
        ? []
        : paths.map((path) => urls.get(path) ?? ""),
    csv,
  };
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

/** A fresh desk: a new session, so the chat, runs and spend start over. */
export async function newDesk() {
  (await cookies()).delete(SESSION_COOKIE);
  await ensureSession();
}

const KIND_BY_TYPE: Record<string, SourceFormat> = {
  "image/jpeg": "image",
  "image/png": "image",
  "text/csv": "csv",
};

/**
 * Stores files dropped on the desk. PDFs arrive with their pages already
 * rendered to JPEG in the browser, and a flag for whether they had a text layer.
 */
export async function uploadDocuments(form: FormData): Promise<DocView[]> {
  const session = await ensureSession();
  const files = form
    .getAll("file")
    .filter((item): item is File => item instanceof File);
  if (files.length === 0) return [];
  if (
    (await countUploads(session.id)) + files.length >
    MAX_UPLOADS_PER_SESSION
  ) {
    throw new Error(`A desk holds at most ${MAX_UPLOADS_PER_SESSION} uploads.`);
  }
  const created: DocumentRow[] = [];
  for (const [index, file] of files.entries()) {
    if (file.size > MAX_UPLOAD_BYTES)
      throw new Error(`${file.name} is over 10 MB.`);
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    const isCsv =
      file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv");
    const sourceFormat: SourceFormat | undefined = isPdf
      ? form.get(`digital-${index}`) === "1"
        ? "pdf_digital"
        : "pdf_scanned"
      : isCsv
        ? "csv"
        : KIND_BY_TYPE[file.type];
    if (!sourceFormat)
      throw new Error(`${file.name}: only PDF, JPEG, PNG or CSV.`);
    const folder = `uploads/${session.id}/${randomUUID()}`;
    const safeName = file.name
      .normalize("NFD")
      .replace(/[^\w.-]+/g, "-")
      .slice(-80);
    const storagePath = `${folder}/${safeName}`;
    const { error } = await supabase()
      .storage.from(BUCKET)
      .upload(storagePath, await file.arrayBuffer(), {
        contentType:
          file.type || (isCsv ? "text/csv" : "application/octet-stream"),
      });
    if (error) throw new Error(error.message);

    const pagePaths: string[] = [];
    if (sourceFormat === "image") {
      pagePaths.push(storagePath);
    } else if (isPdf) {
      const pages = form
        .getAll(`pages-${index}`)
        .filter((item): item is File => item instanceof File)
        .slice(0, 12);
      for (const [pageIndex, page] of pages.entries()) {
        const pagePath = `${folder}/page-${pageIndex + 1}.jpg`;
        const upload = await supabase()
          .storage.from(BUCKET)
          .upload(pagePath, await page.arrayBuffer(), {
            contentType: "image/jpeg",
          });
        if (upload.error) throw new Error(upload.error.message);
        pagePaths.push(pagePath);
      }
    }
    created.push(
      await insertUpload({
        sessionId: session.id,
        name: file.name.slice(0, 200),
        mediaType: file.type || "application/octet-stream",
        sourceFormat,
        storagePath,
        pagePaths,
        sizeBytes: file.size,
      }),
    );
  }
  const urls = await signedUrls(
    created.flatMap((row) => (row.page_paths[0] ? [row.page_paths[0]] : [])),
    6 * 3600,
  );
  return created.map((row) => docView(row, urls));
}
