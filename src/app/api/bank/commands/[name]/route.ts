import {
  commandBodySchema,
  commandParamsSchema,
} from "@/features/bank/domain/api";
import { bankApi } from "@/features/bank/server/api";
import { actorOf } from "@/features/bank/server/services/staff";
import { body, params } from "@/platform/http/middleware";

// A write is one transaction; dispatching its outbox may start a Workflow.
export const maxDuration = 60;

/**
 * Every write of the bank, one route per write command
 * (`domain/commands.ts`): POST /api/bank/commands/<command> with
 * `{ input, idempotencyKey }`, run as the Staff member signed in. Answers
 * the command's outcome (`done`, `needs_confirmation` or `needs_approval`).
 */
export const POST = bankApi
  .use(params(commandParamsSchema))
  .use(body(commandBodySchema))
  .handle(({ services, context, visitor, path, body }) =>
    services.commands.write(
      { actor: actorOf(context), visitor },
      path.name,
      body.input,
      body.idempotencyKey,
    ),
  );
