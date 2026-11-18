import type { DeskStatus, DocumentPages } from "../view";

/**
 * The Casework read API: the GET routes under `/api/casework/` the desk reads
 * through, off the server-action queue (Next sends actions one at a time).
 * Writes stay server actions. The browser calls these only through
 * `components/api.ts`.
 *
 * Every route passes the Access gate and reads only the Owner's open Desk
 * (or the shared Cabinet). Errors are JSON `{ error: string }` with 400 (bad
 * request), 401 (no Access), 404 or 500.
 */
export const API_ROOT = "/api/casework";

/** The most Documents one pages request may ask about. */
export const MAX_PAGE_IDS = 60;

/** Where each route lives. */
export const apiPath = {
  /** GET: the open Desk's Runs, the Owner's Desks, the Spend. */
  desk: () => `${API_ROOT}/desk`,
  /** GET: signed page images (or a CSV's text) for up to 60 Documents. */
  documentPages: (ids: string[]) =>
    `${API_ROOT}/documents/pages?ids=${ids.map(encodeURIComponent).join(",")}`,
  /** GET: a Run's events as NDJSON, from the `from`th on. */
  runEvents: (runId: string, from: number) =>
    `${API_ROOT}/runs/${encodeURIComponent(runId)}/events?from=${from}`,
};

/** `GET apiPath.desk()` */
export type DeskStatusResponse = DeskStatus;

/** `GET apiPath.documentPages(ids)`: by Document id; ids it may not read are left out. */
export type DocumentPagesResponse = Record<string, DocumentPages>;

/** Any route's error body. */
export type ErrorResponse = { error: string };
