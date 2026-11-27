import { randomUUID } from "node:crypto";
import type { Owner } from "@/features/access/domain/owner";
import { ConflictError, InvalidError, LimitError } from "@/platform/errors";
import {
  type UploadRequest,
  type UploadResponse,
  uploadRequestSchema,
} from "../../domain/api";
import type {
  DocumentKind,
  Forgery,
  UploadSummary,
} from "../../domain/contract";
import { manifestEntry, sampleFiles } from "../../domain/corpus";
import { isUploadType, LIMITS, UPLOAD_TYPES } from "../../domain/limits";
import type { LoupePorts, Who } from "../ports";
import { uploadPath } from "../storage";

/** An Owner's own Documents and Forgeries. */
export interface UploadService {
  list(owner: Owner): Promise<UploadSummary[]>;
  /**
   * Opens an Upload: a row and a signed URL the file is PUT to. The storage
   * key is built here from a server-made id and a fixed extension map;
   * nothing the browser sent reaches it (conventions.md). The file is the
   * Owner's: it lives in the private bucket and is never used as a Sample.
   * A Forgery carries the Sample it was made from and the Edits made, as its
   * ground truth.
   */
  open(who: Who, input: UploadRequest): Promise<UploadResponse>;
}

export function createUploadService(
  ports: Pick<LoupePorts, "uploads" | "store"> & { newId?: () => string },
): UploadService {
  const newId = ports.newId ?? randomUUID;
  return {
    list: (owner) => ports.uploads.list(owner),

    async open(who, input) {
      const parsed = uploadRequestSchema.safeParse(input);
      if (!parsed.success)
        throw new InvalidError("That upload doesn't look right.");
      const { contentType, bytes } = parsed.data;
      if (!isUploadType(contentType))
        throw new InvalidError("Upload a PDF, or a JPEG, PNG or WebP image.");
      if (bytes > LIMITS.uploadBytes)
        throw new InvalidError(
          `A Document is at most ${Math.round(LIMITS.uploadBytes / 1024 / 1024)} MB.`,
        );
      const title = parsed.data.title
        .replace(/\p{Cc}+/gu, " ")
        .trim()
        .slice(0, LIMITS.titleChars);
      if (!title) throw new InvalidError("Give the Document a title.");
      let forgery: Forgery | null = null;
      let kind: DocumentKind = parsed.data.kind ?? "other";
      if (parsed.data.forgery) {
        const entry = manifestEntry(parsed.data.forgery.sampleId);
        const files = sampleFiles(parsed.data.forgery.sampleId);
        if (!entry?.featured || !files)
          throw new InvalidError("No such Sample.");
        if (contentType === "application/pdf")
          throw new InvalidError("A Forgery from the bench is an image.");
        if (
          parsed.data.forgery.edits.some(
            (edit) => edit.page > files.pages.length,
          )
        )
          throw new InvalidError(
            "An Edit names a page the Sample does not have.",
          );
        forgery = parsed.data.forgery;
        kind = entry.kind;
      }
      const uploadId = newId();
      const path = uploadPath(who.owner, uploadId, UPLOAD_TYPES[contentType]);
      const signed = await ports.store.signedUpload(path);
      if (!signed)
        throw new ConflictError("The upload could not be opened. Try again.");
      const saved = await ports.uploads.insert({
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
      if ("over" in saved)
        throw new LimitError(
          `That's ${saved.over} uploads today, the demo's daily limit. Try again tomorrow.`,
        );
      return { uploadId, ...signed };
    },
  };
}
