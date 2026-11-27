import { redeemSchema } from "@/features/access/domain/api";
import { atTheDoor, doorApi } from "@/features/access/server/api";
import { body } from "@/platform/http/middleware";

/**
 * A Guest enters a code: this browser becomes a Guest on that pass. The try
 * is counted before the code is looked at, and a wrong one stays counted.
 */
export const POST = doorApi
  .use(body(redeemSchema, { limit: 8 * 1024 }))
  .use(atTheDoor())
  .handle(({ services, browser, access, visitor, body }) =>
    services.door.redeem(browser, { access, visitor }, body),
  );
