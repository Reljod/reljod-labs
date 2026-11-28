import {
  commandParamsSchema,
  readQuerySchema,
} from "@/features/bank/domain/api";
import { bankApi } from "@/features/bank/server/api";
import { actorOf } from "@/features/bank/server/services/staff";
import { params, query } from "@/platform/http/middleware";

/**
 * Every read of the bank, one route per read command (`domain/commands.ts`):
 * GET /api/bank/read/<command>?input=<JSON>. The engine validates the input
 * with the command's schema, checks the Role and scopes the read to the Owner.
 */
export const GET = bankApi
  .use(params(commandParamsSchema))
  .use(query(readQuerySchema))
  .handle(({ services, context, path, query }) =>
    services.commands.read(actorOf(context), path.name, query.input),
  );
