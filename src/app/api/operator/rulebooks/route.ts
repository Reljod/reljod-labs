import {
  type RulebookListResponse,
  type SavedRulebook,
  saveRulebookSchema,
} from "@/features/operator/domain/api";
import { operatorApi } from "@/features/operator/server/api";
import { body } from "@/platform/http/middleware";

/** Every Rulebook version the Owner saved, newest first, then the Default: the first is current. */
export const GET = operatorApi.handle(
  ({ services, owner }): Promise<RulebookListResponse> =>
    services.rulebooks.versions(owner),
);

/** Saves an edited Rulebook as the Owner's next version; the next Run starts under it. */
export const POST = operatorApi
  .use(body(saveRulebookSchema))
  .handle(
    ({ services, owner, visitor, body }): Promise<SavedRulebook> =>
      services.rulebooks.save({ owner, visitor }, body),
  );
