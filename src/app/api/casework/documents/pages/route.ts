import type { DocumentPagesResponse } from "@/features/casework/domain/api";
import { documentPages } from "@/features/casework/server/desk-view";
import { parseDocumentIds } from "@/features/casework/server/read-query";
import {
  failure,
  json,
  RequestError,
} from "@/features/casework/server/respond";
import { currentSession } from "@/features/casework/server/session";

/**
 * Signed page images for several Documents in one request
 * (`?ids=<id>,<id>`): the Cabinet's, or the open Desk's own uploads (none
 * before the Owner has a Desk), never another Desk's. A GET, so a Run's pages
 * load while a write is in flight. `no-store`: the answer holds signed links
 * to an Owner's uploads.
 */
export async function GET(request: Request) {
  try {
    // `currentSession` passes the Access gate and checks the Desk is the Owner's.
    const session = await currentSession();
    const ids = parseDocumentIds(new URL(request.url).searchParams.get("ids"));
    if (!ids) throw new RequestError(400, "Bad document ids.");
    return json<DocumentPagesResponse>(
      await documentPages(ids, session?.id ?? null),
    );
  } catch (error) {
    return failure(error);
  }
}
