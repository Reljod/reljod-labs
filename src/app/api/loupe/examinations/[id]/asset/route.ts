import { z } from "zod";
import { examinationPath, loupeApi } from "@/features/loupe/server/api";
import { params, query } from "@/platform/http/middleware";

/** For an Examination's page images and Evidence layers: written once, never changed. */
const IMMUTABLE = "private, max-age=86400, immutable";

/**
 * A page image or an Evidence layer of one of the Owner's Examinations, by
 * its key. The key must be one of the Examination's own (`pages/`,
 * `layers/`, `looks/`), and the Examination the Owner's. The files are
 * written once and never changed, so the browser may keep them.
 */
export const GET = loupeApi
  .use(params(examinationPath))
  .use(query(z.object({ key: z.string().max(200).optional() })))
  .handle(async ({ services, owner, path, query }) => {
    const asset = await services.examinations.asset(owner, path.id, query.key);
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "content-type": asset.contentType,
        "cache-control": IMMUTABLE,
        "x-content-type-options": "nosniff",
      },
    });
  });
