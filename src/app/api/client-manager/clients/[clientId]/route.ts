import { clientParamsSchema } from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { params } from "@/platform/http/middleware";

const client = clientManagerApi.use(params(clientParamsSchema));

/**
 * A client's first frame: profile and facts, without Edges or quotes. Never
 * kept, even for a Sample: it carries a signed portrait URL that dies in an
 * hour, and `canAdd`, which depends on the visitor.
 */
export const GET = client.handle(({ services, caller, path }) =>
  services.clients.file(caller, path.clientId),
);

/** Deletes the client (softly): its Owner only. */
export const DELETE = client.handle(async ({ services, caller, path }) => {
  await services.clients.remove(caller, path.clientId);
});
