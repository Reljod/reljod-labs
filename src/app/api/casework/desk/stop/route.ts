import type { StopResponse } from "@/features/casework/domain/api";
import { caseworkApi, withDesk } from "@/features/casework/server/api";

/** Stops whatever the open Desk has going: the escape hatch, never confirmed first. */
export const POST = caseworkApi
  .use(withDesk({ create: false }))
  .handle(
    ({ services, desk }): Promise<StopResponse> =>
      services.runs.stopActive(desk),
  );
