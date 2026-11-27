import {
  decisionSchema,
  proposalParamsSchema,
} from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { body, params } from "@/platform/http/middleware";

/** The person's pick from a Research card: add the chosen findings, or dismiss them. */
export const POST = clientManagerApi
  .use(params(proposalParamsSchema))
  .use(body(decisionSchema, { limit: 4 * 1024 }))
  .handle(({ services, caller, path, body }) =>
    services.threads.decide(caller, path.threadId, path.messageId, body),
  );
