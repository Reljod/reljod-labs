import { caseworkApi, withDesk } from "@/features/casework/server/api";

/** Back to the default model settings for every purpose; answers the settings now in force. */
export const DELETE = caseworkApi
  .use(withDesk({ create: true }))
  .handle(({ services, desk }) => services.desks.resetSettings(desk));
