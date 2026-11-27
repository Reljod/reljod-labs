import { newSessionSchema } from "@/features/bank/domain/api";
import { bankApi } from "@/features/bank/server/api";
import { body } from "@/platform/http/middleware";

/** The Owner's conversations with the Teller, newest first. */
export const GET = bankApi.handle(async ({ services, owner }) => ({
  sessions: await services.sessions.list(owner),
}));

/** A new conversation, about a customer of the Owner's bank or none. */
export const POST = bankApi
  .use(body(newSessionSchema))
  .handle(({ services, context, body }) =>
    services.sessions.create(context, body.customerId),
  );
