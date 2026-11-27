import { z } from "zod";
import { operatorApi } from "@/features/operator/server/api";
import { params } from "@/platform/http/middleware";

/**
 * The picture of one Frame of one of the Owner's Runs (PNG). A Frame never
 * changes once taken, so the browser may keep it; it is private to the Owner.
 */
export const GET = operatorApi
  .use(
    params(
      z.object({ runId: z.string().max(64), n: z.coerce.number().catch(-1) }),
    ),
  )
  .handle(async ({ services, owner, path }) => {
    const png = await services.runs.frame(owner, path.runId, path.n);
    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=86400, immutable",
      },
    });
  });
