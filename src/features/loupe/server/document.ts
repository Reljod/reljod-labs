import "server-only";
import type { PageInfo } from "../domain/contract";
import { samplePages } from "../domain/corpus";
import type { ExaminationRow } from "./repository";
import { ownedUpload } from "./repository";
import { sampleBytes } from "./sample-files";
import type { DocumentFile } from "./sandbox";
import { download } from "./storage";

/**
 * The Document of an Examination as a file for the Sandbox: a Sample's (hash
 * checked) or the Owner's Upload from the private bucket. The Upload is read
 * through the Examination's own Owner, never another's.
 */
export function documentOf(
  row: Pick<ExaminationRow, "owner" | "source">,
  origin: string,
): () => Promise<DocumentFile> {
  return async () => {
    if (row.source.kind === "sample") {
      const sample = await sampleBytes(row.source.sampleId, origin);
      return { bytes: sample.bytes, fileName: sample.file };
    }
    const upload = await ownedUpload(row.owner, row.source.uploadId);
    if (!upload) throw new Error("The Upload is gone.");
    const bytes = await download(upload.storage_path);
    if (!bytes) throw new Error("The Upload's file was never received.");
    return { bytes, fileName: upload.storage_path };
  };
}

/** A Sample's pages as static images, for an Examination that has none of its own yet. */
export function fallbackPages(row: Pick<ExaminationRow, "source">): PageInfo[] {
  return row.source.kind === "sample" ? samplePages(row.source.sampleId) : [];
}
