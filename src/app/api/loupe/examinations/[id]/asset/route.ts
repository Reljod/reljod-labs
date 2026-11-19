import { requireOwner } from "@/features/access/server/gate";
import { ownedExamination } from "@/features/loupe/server/repository";
import { failure, IMMUTABLE, notFound } from "@/features/loupe/server/respond";
import {
  assetPath,
  contentTypeOf,
  download,
  isAssetKey,
} from "@/features/loupe/server/storage";

/**
 * A page image or an Evidence layer of one of the Owner's Examinations, by
 * its key. The key must be one of the Examination's own (`pages/`,
 * `layers/`, `looks/`), and the Examination the Owner's. The files are
 * written once and never changed, so the browser may keep them.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [{ owner }, { id }] = await Promise.all([requireOwner(), params]);
    const key = new URL(request.url).searchParams.get("key");
    if (!isAssetKey(key)) return notFound();
    const examination = await ownedExamination(owner, id);
    if (!examination) return notFound();
    const bytes = await download(assetPath(owner, examination.id, key));
    if (!bytes) return notFound();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": contentTypeOf(key),
        "cache-control": IMMUTABLE,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
