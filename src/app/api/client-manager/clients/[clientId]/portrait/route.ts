import {
  clientParamsSchema,
  portraitSchema,
} from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { body, params } from "@/platform/http/middleware";

export const maxDuration = 60;

/**
 * The client's Portrait: where to upload one (`upload`), that it arrived
 * (`confirm`, only for the exact path the upload step handed out), or a new
 * one painted from the Persona (`paint`, under the `build` cap).
 */
export const POST = clientManagerApi
  .use(params(clientParamsSchema))
  .use(body(portraitSchema, { limit: 4 * 1024 }))
  .handle(({ services, caller, path, body }) =>
    services.clients.portrait(caller, path.clientId, body),
  );
