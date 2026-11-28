import { purposeParamsSchema } from "@/features/casework/domain/api";
import { modelSettingsSchema } from "@/features/casework/domain/model-config";
import { caseworkApi, withDesk } from "@/features/casework/server/api";
import { body, params } from "@/platform/http/middleware";

/** One purpose's model settings for the open Desk; answers the settings now in force. */
export const PUT = caseworkApi
  .use(params(purposeParamsSchema))
  .use(body(modelSettingsSchema))
  .use(withDesk({ create: true }))
  .handle(({ services, desk, path, body }) =>
    services.desks.saveSettings(desk, path.purpose, body),
  );
