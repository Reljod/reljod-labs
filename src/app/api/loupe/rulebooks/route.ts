import {
  type RulebookListResponse,
  type SaveRulebookResponse,
  saveRulebookSchema,
} from "@/features/loupe/domain/api";
import { loupeApi } from "@/features/loupe/server/api";
import { body } from "@/platform/http/middleware";

/** Every Rulebook version of the Owner, newest first, then the Defaults. */
export const GET = loupeApi.handle(
  ({ services, owner }): Promise<RulebookListResponse> =>
    services.rulebooks.list(owner),
);

/** Saves the Rulebook as the Owner's next version. */
export const POST = loupeApi
  .use(body(saveRulebookSchema))
  .handle(
    ({ services, who, body }): Promise<SaveRulebookResponse> =>
      services.rulebooks.save(who, body),
  );
