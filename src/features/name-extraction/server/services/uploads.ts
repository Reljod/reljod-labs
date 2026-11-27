import { createHash } from "node:crypto";
import type { Owner } from "@/features/access/domain/owner";
import { ConflictError, InvalidError, LimitError } from "@/platform/errors";
import type { Visitor } from "@/platform/request/visitor";
import type {
  CreateUploadRequest,
  CreateUploadResponse,
} from "../../domain/api";
import { LIMITS } from "../../domain/limits";
import type { SievePorts } from "../ports";

/** An Owner's own Documents: text read in the browser, stored as `{ pages }` JSON in the private bucket. */
export interface UploadService {
  /**
   * Opens an Upload: a row and a signed URL the browser PUTs the pages to.
   * The pages are checked again when a Run loads them (at most
   * `LIMITS.maxPages` pages of `LIMITS.charsPerPage` characters).
   */
  create(
    caller: { owner: Owner; visitor: Visitor },
    input: CreateUploadRequest,
  ): Promise<CreateUploadResponse>;
}

const DAY_MS = 86_400_000;

/** A stable, non-reversible folder per Owner: no raw input reaches a storage key. */
export function ownerFolder(owner: string) {
  return createHash("sha256")
    .update(`name-extraction:${owner}`)
    .digest("hex")
    .slice(0, 32);
}

export function createUploadService(
  ports: Pick<SievePorts, "uploads" | "store" | "now" | "newId">,
): UploadService {
  return {
    async create({ owner, visitor }, input) {
      const title = input.title
        .replace(/\p{Cc}+/gu, " ")
        .trim()
        .slice(0, 200);
      if (!title) throw new InvalidError("Give the upload a title.");
      if (!(input.pages >= 1 && input.pages <= LIMITS.maxPages))
        throw new InvalidError(`An upload has 1 to ${LIMITS.maxPages} pages.`);
      if (
        !visitor.trusted &&
        (await ports.uploads.countSince(
          owner,
          new Date(ports.now() - DAY_MS),
        )) >= LIMITS.uploadsPerOwnerPerDay
      )
        throw new LimitError(
          `That's ${LIMITS.uploadsPerOwnerPerDay} uploads today. Try again tomorrow.`,
        );
      const uploadId = ports.newId();
      const path = `uploads/${ownerFolder(owner)}/${uploadId}.json`;
      const signed = await ports.store.signedUploadUrl(path);
      if (!signed)
        throw new ConflictError("The upload could not be opened. Try again.");
      await ports.uploads.insert({
        id: uploadId,
        owner,
        title,
        pages: input.pages,
        storagePath: path,
      });
      return {
        uploadId,
        signedUrl: signed.signedUrl,
        token: signed.token,
        path,
      };
    },
  };
}
