import { z } from "zod";
import type { SourceUploadUrlResponse } from "@/features/harness/domain/api";
import { requirePermission } from "@/features/harness/server/context";
import { createUpload } from "@/features/harness/server/knowledge";
import { bodyOf, failure, json } from "@/features/harness/server/respond";

const schema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().max(255).default(""),
  bytes: z.number().int().positive(),
  sessionId: z.string().nullish(),
});

/** Registers a Source as pending and answers a signed URL the browser PUTs the file to. */
export async function POST(request: Request) {
  try {
    const context = await requirePermission("source.add");
    const body = schema.parse(await bodyOf(request));
    return json<SourceUploadUrlResponse>(
      await createUpload({ ...context, ...body }),
    );
  } catch (error) {
    return failure(error);
  }
}
