import {
  questionSchema,
  type StartAskResult,
} from "@/features/ledger/domain/api";
import { ledgerApi } from "@/features/ledger/server/api";
import { body } from "@/platform/http/middleware";

/**
 * Opens an Ask session for a question; the session page plays its first
 * Build. Over the cap it opens nothing and points at the Owner's latest
 * answer instead (it only peeks: the Build takes the hit).
 */
export const POST = ledgerApi
  .use(body(questionSchema))
  .handle(
    ({ services, caller, ask, body }): Promise<StartAskResult> =>
      services.start(caller, body.question, ask),
  );
