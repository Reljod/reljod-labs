import {
  type CatalogResponse,
  intakeSchema,
} from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { body } from "@/platform/http/middleware";

/** The Catalog: every Sample plus the Owner's own clients. */
export const GET = clientManagerApi.handle(
  async ({ services, owner }): Promise<CatalogResponse> => ({
    clients: await services.clients.catalog(owner),
  }),
);

/**
 * The Intake: creates the client and its first Build, and hands back signed
 * URLs the browser uploads each file to before it starts the Build.
 */
export const POST = clientManagerApi
  .use(body(intakeSchema))
  .handle(({ services, caller, body }) => services.builds.intake(caller, body));
