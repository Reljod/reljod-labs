import { z } from "zod";
import type { ConflictResponse } from "@/features/harness/domain/api";
import { RESOLUTIONS } from "@/features/harness/domain/knowledge";
import { harnessApi, idSchema, permits } from "@/features/harness/server/api";
import { authorize, body, params } from "@/platform/http/middleware";

const schema = z.object({ resolution: z.enum(RESOLUTIONS) });

/** Settles a Conflict (admin): supersede, keep both or set aside. Settling twice is a 409. */
export const POST = harnessApi
  .use(authorize(permits("conflict.resolve")))
  .use(params(idSchema))
  .use(body(schema))
  .handle(
    async ({ services, caller, path, body }): Promise<ConflictResponse> => ({
      conflict: await services.knowledge.resolve(
        caller,
        path.id,
        body.resolution,
      ),
    }),
  );
