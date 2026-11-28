import { z } from "zod";
import type { RunEvent } from "@/features/harness/domain/run";
import { harnessApi, idSchema } from "@/features/harness/server/api";
import { params, query } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// Stays open while the Run streams; a reconnect resumes from `?from=`.
export const maxDuration = 300;

const schema = z.object({ from: z.coerce.number().int().min(0).catch(0) });

/** The Run's live stream as NDJSON `RunEvent`s, from event number `from`. A Run that is not the Owner's is a JSON 404. */
export const GET = harnessApi
  .use(params(idSchema))
  .use(query(schema))
  .handle(async ({ services, caller, path, query, request }) =>
    ndjson<RunEvent>(
      await services.runs.events(caller, path.id, query.from ?? 0),
      { scope: "harness", signal: request.signal },
    ),
  );
