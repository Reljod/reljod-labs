import {
  additionSchema,
  clientParamsSchema,
} from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { body, params } from "@/platform/http/middleware";

/** An addition: more notes or files folded into an existing Client graph. */
export const POST = clientManagerApi
  .use(params(clientParamsSchema))
  .use(body(additionSchema))
  .handle(({ services, caller, path, body }) =>
    services.builds.addition(caller, path.clientId, body),
  );
