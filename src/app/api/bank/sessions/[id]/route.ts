import { sessionParamsSchema } from "@/features/bank/domain/api";
import { bankApi } from "@/features/bank/server/api";
import { params } from "@/platform/http/middleware";

const session = bankApi.use(params(sessionParamsSchema));

/** One conversation: its messages and the requests in it that wait for the person. */
export const GET = session.handle(({ services, owner, path }) =>
  services.sessions.detail(owner, path.id),
);

/** Deletes a conversation (soft: purged with its messages 30 days later). */
export const DELETE = session.handle(({ services, owner, path }) =>
  services.sessions.remove(owner, path.id),
);
