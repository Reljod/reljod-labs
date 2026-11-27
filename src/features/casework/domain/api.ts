import { z } from "zod";
import type { DeskStatus, DocumentPages } from "../view";
import { MAX_MESSAGE_LENGTH } from "./chat-events";
import { PURPOSE_IDS, type Purpose } from "./model-config";

/**
 * The Casework REST API under `/api/casework/`. The browser calls it only
 * through `components/api.ts`; the Specialist and outside clients reach the
 * same services through the MCP server (`/api/casework/mcp`, bearer token).
 *
 * Every route but MCP passes the Access gate and reaches only the Owner's
 * Desks (or the shared Cabinet). The open Desk is the Owner's Desk the
 * browser remembers (the `casework_session` cookie), else their latest.
 * Errors are JSON `{ error: string }` with 400, 401 (no Access), 403 (a write
 * from another site), 404, 409 (a Run already going), 429 (a cap) or 500.
 */
export const API_ROOT = "/api/casework";

/** The most Documents one pages request may ask about. */
export const MAX_PAGE_IDS = 60;

/** Where each route lives. */
export const ROUTES = {
  /** GET: the open Desk's Runs, the Owner's Desks, the Spend. PUT: open a Desk (`OpenDeskRequest`) with everything it shows. */
  desk: `${API_ROOT}/desk`,
  /** POST: a fresh Desk, opened. */
  desks: `${API_ROOT}/desks`,
  /** DELETE: back to the default model settings. */
  settings: `${API_ROOT}/desk/settings`,
  /** PUT: one purpose's model settings. */
  setting: (purpose: Purpose) =>
    `${API_ROOT}/desk/settings/${encodeURIComponent(purpose)}`,
  /** POST: stop whatever the open Desk has going. */
  stop: `${API_ROOT}/desk/stop`,
  /** POST: one message to the Specialist, answered as NDJSON ChatEvents. */
  chat: `${API_ROOT}/chat`,
  /** POST: signed slots to upload dropped files to. */
  uploads: `${API_ROOT}/uploads`,
  /** POST: record finished uploads as Documents of the open Desk. */
  documents: `${API_ROOT}/documents`,
  /** GET `?ids=<id>,<id>`: signed page images (or a CSV's text) for up to 60 Documents. */
  documentPages: `${API_ROOT}/documents/pages`,
  /** GET `?from=n`: a Run's events as NDJSON, from the `n`th on. */
  runEvents: (runId: string) =>
    `${API_ROOT}/runs/${encodeURIComponent(runId)}/events`,
  /** POST: stop one Run of the open Desk. */
  runStop: (runId: string) =>
    `${API_ROOT}/runs/${encodeURIComponent(runId)}/stop`,
  /** POST (`Answer`): answer a waiting Run's Question. */
  answer: (questionId: string) =>
    `${API_ROOT}/questions/${encodeURIComponent(questionId)}/answer`,
};

// Request schemas ------------------------------------------------------------

/** `PUT ROUTES.desk`: the Desk to open, or none for the current one (created on first use). */
export const openDeskSchema = z.object({
  deskId: z.guid().nullish(),
});

export const chatRequestSchema = z
  .object({
    text: z.string().max(MAX_MESSAGE_LENGTH),
    documentIds: z.array(z.string().max(64)).max(12),
  })
  .refine((message) => message.text.trim() || message.documentIds.length > 0, {
    message: "Empty message",
  });

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** One file the browser wants to upload. PDFs only: how many pages it rendered, and whether it found a text layer. */
export const uploadRequestSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().max(1000),
        type: z.string().max(200),
        size: z.number(),
        pages: z.number(),
        digital: z.boolean(),
      }),
    )
    .max(60),
});

export type UploadRequest = z.infer<
  typeof uploadRequestSchema
>["files"][number];

export const finishUploadsSchema = z.object({
  tickets: z.array(z.string().max(8000)).max(60),
});

export const purposeParamsSchema = z.object({
  purpose: z.enum(PURPOSE_IDS as [Purpose, ...Purpose[]]),
});

// Any 8-4-4-4-12 hex id, like the repository accepts; not only RFC 4122 versions.
export const runParamsSchema = z.object({ runId: z.guid() });
export const questionParamsSchema = z.object({ questionId: z.guid() });

export const runEventsQuerySchema = z.object({
  from: z.coerce.number().int().min(0).catch(0),
});

/** `?ids=`: comma-separated Document ids, deduplicated, 1 to 60 of them. */
export const documentPagesQuerySchema = z.object({
  ids: z
    .string({ error: "Bad document ids." })
    .transform((raw) => [
      ...new Set(
        raw
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(
      z
        .array(z.guid({ error: "Bad document ids." }))
        .min(1, { error: "Bad document ids." })
        .max(MAX_PAGE_IDS, { error: "Bad document ids." }),
    ),
});

// Responses ----------------------------------------------------------------------

/** `GET ROUTES.desk` */
export type DeskStatusResponse = DeskStatus;

/** `GET ROUTES.documentPages`: by Document id; ids it may not read are left out. */
export type DocumentPagesResponse = Record<string, DocumentPages>;

/** `POST ROUTES.uploads`: one slot per file, in order. */
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

/** `POST ROUTES.answer(id)` */
export type AnswerResponse = { runId: string; alreadyAnswered: boolean };

/** `POST ROUTES.runStop(id)` and `POST ROUTES.stop` */
export type StopResponse =
  | { runId: string; stopped: boolean; status: string }
  | { runId: null; stopped: false };

/** Any route's error body. */
export type ErrorResponse = { error: string };
