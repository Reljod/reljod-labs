import {
  eventsQuerySchema,
  runPathSchema,
} from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";
import { params, query } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// Stays open while the run streams; a reconnect resumes from `from`.
export const maxDuration = 300;

/** A live Pre-screen run's ScanEvents as NDJSON; another Owner's run is not found. */
export const GET = documentComplianceApi
  .use(params(runPathSchema))
  .use(query(eventsQuerySchema))
  .handle(async ({ services, owner, path, query, request }) =>
    ndjson(await services.runs.events(owner, path.runId, query.from), {
      scope: "document-compliance",
      signal: request.signal,
    }),
  );
