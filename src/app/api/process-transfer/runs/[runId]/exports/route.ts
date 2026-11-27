import {
  exportRequestSchema,
  runParamsSchema,
} from "@/features/process-transfer/domain/api";
import { handoverApi } from "@/features/process-transfer/server/api";
import { body, params } from "@/platform/http/middleware";

/**
 * A download of the workflow document (DOCX) or the Deck (PPTX), written to
 * the Audit trail before the browser saves the file it built. Refused for a
 * Deck that is not approved.
 */
export const POST = handoverApi
  .use(params(runParamsSchema))
  .use(body(exportRequestSchema))
  .handle(({ services, owner, path, body }) =>
    services.runs.recordExport(owner, path.runId, body.kind),
  );
