import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ConflictError } from "@/platform/errors";
import type { UploadRequest, UploadSlot } from "../../domain/api";
import type { SourceFormat } from "../../domain/run-state";
import {
  SNIFF_BYTES,
  storedProblem,
  ticketExpired,
  UPLOADS,
} from "../../domain/uploads";
import type { DocView } from "../../view";
import type { CabinetStore, CaseworkStorage } from "../ports";
import type { NewUpload, SessionRow } from "../repository";
import { docView } from "./desks";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
/** Files one request may open slots for, or finish. */
const MAX_FILES = 60;
/** Thumbnails of new uploads, signed as long as the Cabinet's. */
const THUMB_TTL_S = 6 * 3600;

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

/**
 * Files dropped on a Desk: a slot to upload each straight to Storage, then
 * recording what Storage really holds as the Desk's Documents. The browser's
 * word on type, size and pages only opens a slot; a ticket is signed, bound to
 * its Desk, expires, and is good once.
 */
export interface UploadService {
  /**
   * Opens slots for files dropped on the Desk: one signed Storage URL for each
   * file and each rendered PDF page, so the browser uploads straight to Storage
   * and files of any number and size skip the server's request limit.
   */
  begin(desk: SessionRow, files: UploadRequest[]): Promise<UploadSlot[]>;
  /** Records the files the browser finished uploading as Documents of this Desk. */
  finish(desk: SessionRow, tickets: string[]): Promise<DocView[]>;
}

export type UploadPorts = {
  cabinet: Pick<
    CabinetStore,
    "countUploads" | "recordedPaths" | "insertUploads"
  >;
  storage: CaseworkStorage;
  /** The secret tickets are signed with. */
  secret: () => string;
  newId: () => string;
  now: () => number;
};

export function createUploadService(ports: UploadPorts): UploadService {
  const { cabinet, storage } = ports;

  const sign = (payload: string) =>
    createHmac("sha256", ports.secret())
      .update(`casework-upload:${payload}`)
      .digest("base64url");

  /** The ticket's claims, if it was signed here, for this Desk, and is not expired. */
  function readTicket(ticket: string, deskId: string): UploadTicket | null {
    const [payload, signature, ...rest] = String(ticket).split(".");
    if (!payload || !signature || rest.length > 0) return null;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return null;
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as UploadTicket;
    if (parsed.sessionId !== deskId) return null;
    return ticketExpired(parsed.expiresAt, ports.now()) ? null : parsed;
  }

  /**
   * The upload as Storage holds it, or null when it is not what the ticket
   * said: the file must exist, be within the size cap and start with its
   * type's signature. A PDF keeps only the page images that were really
   * stored, each a JPEG within the cap, so its page count is what was
   * uploaded, not what the browser claimed.
   */
  async function verified(
    ticket: UploadTicket,
  ): Promise<{ sizeBytes: number; pagePaths: string[] } | null> {
    const file = await storage.stored(ticket.storagePath, SNIFF_BYTES);
    if (storedProblem(file, ticket.mediaType) || !file) return null;
    if (ticket.sourceFormat === "image")
      return { sizeBytes: file.size, pagePaths: [ticket.storagePath] };
    const pages = await Promise.all(
      ticket.pagePaths
        .slice(0, UPLOADS.maxPages)
        .map(async (path) =>
          storedProblem(await storage.stored(path, SNIFF_BYTES), "image/jpeg")
            ? null
            : path,
        ),
    );
    return {
      sizeBytes: file.size,
      pagePaths: pages.filter((path): path is string => path !== null),
    };
  }

  return {
    async begin(desk, files) {
      const room = UPLOADS.perDesk - (await cabinet.countUploads(desk.id));
      let taken = 0;
      const slots: Promise<UploadSlot>[] = [];
      for (const file of files.slice(0, MAX_FILES)) {
        const name = String(file.name).slice(0, 200);
        const lower = name.toLowerCase();
        const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
        const isCsv = file.type === "text/csv" || lower.endsWith(".csv");
        const isImage =
          IMAGE_TYPES.has(file.type) || /\.(jpe?g|png)$/.test(lower);
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
          slots.push(
            Promise.resolve({
              ok: false,
              name,
              reason: "only PDF, JPEG, PNG or CSV",
            }),
          );
          continue;
        }
        if (!(file.size > 0) || file.size > UPLOADS.maxBytes) {
          slots.push(
            Promise.resolve({ ok: false, name, reason: "over 10 MB" }),
          );
          continue;
        }
        if (taken >= room) {
          slots.push(
            Promise.resolve({
              ok: false,
              name,
              reason: `a desk holds at most ${UPLOADS.perDesk} uploads`,
            }),
          );
          continue;
        }
        taken++;
        // The path is built from ids and a sanitised name, never raw browser input.
        const folder = `uploads/${desk.id}/${ports.newId()}`;
        const safeName =
          name
            .normalize("NFD")
            .replace(/[^\w.-]+/g, "-")
            .slice(-80) || "file";
        const storagePath = `${folder}/${safeName}`;
        const pageCount = isPdf
          ? Math.max(0, Math.min(UPLOADS.maxPages, Math.trunc(file.pages)))
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
        const payload = Buffer.from(
          JSON.stringify({
            sessionId: desk.id,
            name,
            mediaType: contentType,
            sourceFormat,
            storagePath,
            pagePaths,
            sizeBytes: Math.trunc(file.size),
            expiresAt: ports.now() + UPLOADS.ticketMs,
          } satisfies UploadTicket),
        ).toString("base64url");
        // Every file's URLs are signed at once, not one file after another.
        slots.push(
          Promise.all([
            storage.signedUploadUrl(storagePath),
            ...(isPdf
              ? pagePaths.map((path) => storage.signedUploadUrl(path))
              : []),
          ]).then(([fileUrl, ...pageUrls]) => ({
            ok: true as const,
            name,
            ticket: `${payload}.${sign(payload)}`,
            fileUrl: fileUrl ?? "",
            contentType,
            pageUrls,
          })),
        );
      }
      return Promise.all(slots);
    },

    async finish(desk, tickets) {
      const read = tickets
        .slice(0, MAX_FILES)
        .flatMap((ticket) => readTicket(ticket, desk.id) ?? []);
      // A ticket is good once: one whose file is already a Document is dropped.
      const [recorded, count] = await Promise.all([
        cabinet.recordedPaths(
          desk.id,
          read.map((ticket) => ticket.storagePath),
        ),
        cabinet.countUploads(desk.id),
      ]);
      const seen = new Set<string>();
      const valid = read.filter((ticket) => {
        if (recorded.has(ticket.storagePath) || seen.has(ticket.storagePath))
          return false;
        seen.add(ticket.storagePath);
        return true;
      });
      if (valid.length === 0) return [];
      if (count + valid.length > UPLOADS.perDesk)
        throw new ConflictError(
          `A desk holds at most ${UPLOADS.perDesk} uploads.`,
        );
      const checked = await Promise.all(valid.map(verified));
      const uploads = valid.flatMap((ticket, index): NewUpload[] => {
        const stored = checked[index];
        return stored
          ? [
              {
                sessionId: desk.id,
                name: ticket.name,
                mediaType: ticket.mediaType,
                sourceFormat: ticket.sourceFormat,
                storagePath: ticket.storagePath,
                pagePaths: stored.pagePaths,
                sizeBytes: stored.sizeBytes,
              },
            ]
          : [];
      });
      const created = await cabinet.insertUploads(uploads);
      const urls = await storage.signedUrls(
        created.flatMap((row) =>
          row.page_paths[0] ? [row.page_paths[0]] : [],
        ),
        THUMB_TTL_S,
      );
      return created.map((row) => docView(row, urls));
    },
  };
}
