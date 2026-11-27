import {
  type RulebookListResponse,
  type SaveRulebookResponse,
  saveRulebookSchema,
} from "@/features/name-extraction/domain/api";
import { sieveApi } from "@/features/name-extraction/server/api";
import { body } from "@/platform/http/middleware";

/** Every Rulebook version the Owner saved, newest first, then the default: the first is the current one. */
export const GET = sieveApi.handle(
  ({ services, owner }): Promise<RulebookListResponse> =>
    services.rulebooks.versions(owner),
);

/** Saves the Rulebook as the Owner's next version (capped per day); answers with that version. */
export const POST = sieveApi
  .use(body(saveRulebookSchema))
  .handle(
    ({ services, caller, body }): Promise<SaveRulebookResponse> =>
      services.rulebooks.save(caller, body),
  );
