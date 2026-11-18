import { z } from "zod";
import { MAX_PAGE_IDS } from "../domain/api";

// Any 8-4-4-4-12 hex id, like the repository accepts; not only RFC 4122 versions.
const documentId = z.guid();

/**
 * The `ids` of a `GET /api/casework/documents/pages` request: comma-separated
 * Document ids, deduplicated. Null when any is not a Document id or there are
 * none or too many, so the route answers 400 rather than guessing.
 */
export function parseDocumentIds(raw: string | null): string[] | null {
  if (!raw) return null;
  const ids = [...new Set(raw.split(",").map((id) => id.trim()))].filter(
    Boolean,
  );
  if (ids.length === 0 || ids.length > MAX_PAGE_IDS) return null;
  return ids.every((id) => documentId.safeParse(id).success) ? ids : null;
}
