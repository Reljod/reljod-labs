import { z } from "zod";
import type { SourceUploadUrlResponse } from "@/features/harness/domain/api";
import { harnessApi, permits } from "@/features/harness/server/api";
import { authorize, body } from "@/platform/http/middleware";

const schema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().max(255).default(""),
  bytes: z.number().int().positive(),
  sessionId: z.string().max(64).nullish(),
});

/** Registers a Source as pending and answers a signed URL the browser PUTs the file to. */
export const POST = harnessApi
  .use(authorize(permits("source.add")))
  .use(body(schema))
  .handle(
    ({ services, caller, body }): Promise<SourceUploadUrlResponse> =>
      services.knowledge.upload(caller, body),
  );
