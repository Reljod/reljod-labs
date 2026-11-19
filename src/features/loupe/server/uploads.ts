import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DOCUMENT_KINDS,
  type DocumentKind,
  editSchema,
  type Forgery,
} from "../domain/contract";
import { manifestEntry, sampleFiles } from "../domain/corpus";
import { isUploadType, LIMITS, UPLOAD_TYPES } from "../domain/limits";
import type { Who } from "./examinations";
import { insertUpload } from "./repository";
import { signedUpload, uploadPath } from "./storage";

export const uploadInputSchema = z.object({
  title: z.string().max(400),
  contentType: z.string().max(60),
  bytes: z.number().int().min(1),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  forgery: z
    .object({
      sampleId: z.string().max(60),
      edits: z.array(editSchema).min(1).max(LIMITS.editsPerForgery),
    })
    .optional(),
});
export type UploadInput = z.infer<typeof uploadInputSchema>;

export type OpenedUpload = {
  uploadId: string;
  signedUrl: string;
  token: string;
  path: string;
};

/**
 * Opens an Upload: a row and a signed URL the file is PUT to. The storage
 * key is built here from a server-made id and a fixed extension map; nothing
 * the browser sent reaches it (conventions.md). The file is the Owner's: it
 * lives in the private bucket and is never used as a Sample. A Forgery
 * carries the Sample it was made from and the Edits made, as its ground truth.
 */
export async function openUpload(
  who: Who,
  input: UploadInput,
): Promise<OpenedUpload | { error: string }> {
  const parsed = uploadInputSchema.safeParse(input);
  if (!parsed.success) return { error: "That upload doesn't look right." };
  const { contentType, bytes } = parsed.data;
  if (!isUploadType(contentType))
    return { error: "Upload a PDF, or a JPEG, PNG or WebP image." };
  if (bytes > LIMITS.uploadBytes)
    return {
      error: `A Document is at most ${Math.round(LIMITS.uploadBytes / 1024 / 1024)} MB.`,
    };
  const title = parsed.data.title
    .replace(/\p{Cc}+/gu, " ")
    .trim()
    .slice(0, LIMITS.titleChars);
  if (!title) return { error: "Give the Document a title." };
  let forgery: Forgery | null = null;
  let kind: DocumentKind = parsed.data.kind ?? "other";
  if (parsed.data.forgery) {
    const entry = manifestEntry(parsed.data.forgery.sampleId);
    const files = sampleFiles(parsed.data.forgery.sampleId);
    if (!entry?.featured || !files) return { error: "No such Sample." };
    if (contentType === "application/pdf")
      return { error: "A Forgery from the bench is an image." };
    if (
      parsed.data.forgery.edits.some((edit) => edit.page > files.pages.length)
    )
      return { error: "An Edit names a page the Sample does not have." };
    forgery = parsed.data.forgery;
    kind = entry.kind;
  }
  const uploadId = randomUUID();
  const path = uploadPath(who.owner, uploadId, UPLOAD_TYPES[contentType]);
  const signed = await signedUpload(path);
  if (!signed) return { error: "The upload could not be opened. Try again." };
  const saved = await insertUpload({
    id: uploadId,
    owner: who.owner,
    title,
    kind,
    format: contentType === "application/pdf" ? "pdf" : "image",
    contentType,
    bytes,
    storagePath: path,
    forgery,
    visitorHash: who.visitor.hash,
    perDay: who.visitor.trusted ? null : LIMITS.uploadsPerOwnerPerDay,
    via: who.via,
  });
  if ("refusal" in saved) return { error: saved.refusal };
  return { uploadId, ...signed };
}
