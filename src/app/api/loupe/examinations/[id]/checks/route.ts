import {
  type CheckResponse,
  checkRequestSchema,
} from "@/features/loupe/domain/api";
import { examinationPath, loupeApi } from "@/features/loupe/server/api";
import { InvalidError } from "@/platform/errors";
import { body, params } from "@/platform/http/middleware";

// The Check runs in a Sandbox inside the request.
export const maxDuration = 120;

/**
 * Runs one named Check again on one of the Owner's Examinations, on a page
 * or a region: the same service, cap and Trail as the MCP tool `run_check`,
 * as the Owner's own client.
 */
export const POST = loupeApi
  .use(params(examinationPath))
  .use(body(checkRequestSchema))
  .handle(async ({ services, who, path, body }): Promise<CheckResponse> => {
    const outcome = await services.tools.runCheck(
      {
        owner: who.owner,
        visitor: who.visitor,
        role: { kind: "client" },
        origin: who.origin,
      },
      { examinationId: path.id, ...body },
    );
    if (!outcome.ok) throw new InvalidError(outcome.text.slice(0, 300));
    return { text: outcome.text };
  });
