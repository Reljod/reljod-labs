import { signInSchema } from "@/features/access/domain/api";
import { atTheDoor, doorApi } from "@/features/access/server/api";
import { body } from "@/platform/http/middleware";

/** Who this browser is, for the header's profile menu (null for a visitor). */
export const GET = doorApi.handle(({ services, browser, access }) =>
  services.door.whoIs(browser, access),
);

/**
 * A Host signs in. Every try is counted first (`takeAttempt`) and settled
 * only when it worked; the answer names where to go next.
 */
export const POST = doorApi
  .use(body(signInSchema, { limit: 8 * 1024 }))
  .use(atTheDoor())
  .handle(({ services, browser, visitor, body }) =>
    services.door.signIn(browser, visitor, body),
  );

/** Ends this browser's session, Host or Guest; a Guest's device goes back to the pass. */
export const DELETE = doorApi.handle(({ services, browser }) =>
  services.door.signOut(browser),
);
