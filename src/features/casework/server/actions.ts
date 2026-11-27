"use server";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  type ModelSettings,
  modelSettingsSchema,
  PURPOSE_IDS,
  type Purpose,
} from "../domain/model-config";
import { type Answer, answerSchema } from "../domain/run-events";
import type { SourceFormat } from "../domain/run-state";
import {
  SNIFF_BYTES,
  storedProblem,
  ticketExpired,
  UPLOADS,
} from "../domain/uploads";
import type { DeskView, DocView } from "../view";
import { deskView, docView, thumbUrls } from "./desk-view";
import { env } from "./env";
import {
  countUploads,
  type DocumentRow,
  insertUpload,
  recordedUploadPaths,
  setModelOverrides,
} from "./repository";
import { answerQuestion, settingsFor, stopActiveRun, stopRun } from "./runs";
import {
  ensureDesk,
  ensureSession,
  startSession,
  switchSession,
} from "./session";
import { BUCKET, storedObject, supabase } from "./supabase";

const MAX_UPLOAD_BYTES = UPLOADS.maxBytes;
const MAX_UPLOADS_PER_SESSION = UPLOADS.perDesk;

/** Everything the desk shows on load: the Cabinet, the chat so far, runs, spend, settings. */
export async function openDesk(): Promise<DeskView> {
  const { owner, session } = await ensureDesk();
  return deskView(owner, session);
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

/** A fresh desk: a new session, opened. The old ones stay on the list to go back to. */
export async function newDesk(): Promise<DeskView> {
  const { owner, session } = await startSession();
  return deskView(owner, session);
}

/**
 * Goes back to an earlier desk of this Owner and opens it in the same call,
 * or answers null when it is not theirs.
 */
export async function openEarlierDesk(id: string): Promise<DeskView | null> {
  const opened = await switchSession(String(id));
  return opened ? deskView(opened.owner, opened.session) : null;
}

/** Stops a Run, or whatever this desk has going. */
export async function stop(runId?: string | null) {
  const session = await ensureSession();
  return runId ? stopRun(session, String(runId)) : stopActiveRun(session);
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_PAGES = UPLOADS.maxPages;

type UploadTicket = {
  sessionId: string;
  name: string;
  mediaType: string;
  sourceFormat: SourceFormat;
  storagePath: string;
  pagePaths: string[];
  /** What the browser said; the recorded size is read from Storage. */
  sizeBytes: number;
  /** When the ticket stops being accepted (ms since epoch). */
  expiresAt: number;
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
  if (parsed.sessionId !== sessionId) return null;
  return ticketExpired(parsed.expiresAt) ? null : parsed;
}

/**
 * The upload as Storage holds it, or null when it is not what the ticket
 * said: the file must exist, be within the size cap and start with its
 * type's signature. A PDF keeps only the page images that were really
 * stored, each a JPEG within the cap, so its page count is what was
 * uploaded, not what the browser claimed.
 */
async function verifiedUpload(
  ticket: UploadTicket,
): Promise<{ sizeBytes: number; pagePaths: string[] } | null> {
  const file = await storedObject(ticket.storagePath, SNIFF_BYTES);
  if (storedProblem(file, ticket.mediaType) || !file) return null;
  if (ticket.sourceFormat === "image") {
    return { sizeBytes: file.size, pagePaths: [ticket.storagePath] };
  }
  const pages = await Promise.all(
    ticket.pagePaths
      .slice(0, MAX_PAGES)
      .map(async (path) =>
        storedProblem(await storedObject(path, SNIFF_BYTES), "image/jpeg")
          ? null
          : path,
      ),
  );
  return {
    sizeBytes: file.size,
    pagePaths: pages.filter((path): path is string => path !== null),
  };
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
        expiresAt: Date.now() + UPLOADS.ticketMs,
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
  const read = tickets
    .slice(0, 60)
    .flatMap((ticket) => readTicket(ticket, session.id) ?? []);
  // A ticket is good once: one whose file is already a Document is dropped.
  const recorded = await recordedUploadPaths(
    session.id,
    read.map((ticket) => ticket.storagePath),
  );
  const seen = new Set<string>();
  const valid = read.filter((ticket) => {
    if (recorded.has(ticket.storagePath) || seen.has(ticket.storagePath)) {
      return false;
    }
    seen.add(ticket.storagePath);
    return true;
  });
  if (valid.length === 0) return [];
  if (
    (await countUploads(session.id)) + valid.length >
    MAX_UPLOADS_PER_SESSION
  ) {
    throw new Error(`A desk holds at most ${MAX_UPLOADS_PER_SESSION} uploads.`);
  }
  const checked = await Promise.all(valid.map(verifiedUpload));
  const created: DocumentRow[] = [];
  for (const [index, ticket] of valid.entries()) {
    const stored = checked[index];
    if (!stored) continue;
    const row = await insertUpload({
      sessionId: session.id,
      name: ticket.name,
      mediaType: ticket.mediaType,
      sourceFormat: ticket.sourceFormat,
      storagePath: ticket.storagePath,
      pagePaths: stored.pagePaths,
      sizeBytes: stored.sizeBytes,
    });
    if (row) created.push(row);
  }
  const urls = await thumbUrls(created);
  return created.map((row) => docView(row, urls));
}
