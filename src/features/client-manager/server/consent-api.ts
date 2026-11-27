import "server-only";
import { currentAccess } from "@/features/access/server/gate";
import { sameOrigin, withServices } from "@/platform/http/middleware";
import { api, derive } from "@/platform/http/pipeline";
import { container } from "@/platform/services/container";
import { createConsentService } from "./consent";
import { env } from "./env";
import { currentGrant } from "./mcp-auth";

const consent = container(() =>
  createConsentService({
    secret: env.rateLimitSalt,
    grant: currentGrant,
    now: Date.now,
  }),
);

/**
 * The consent page's stack: writes from this site only, the Access of the
 * request (null is refused by the service, after the proxy refused it first)
 * and the consent service.
 */
export const consentApi = api("client-manager")
  .use(sameOrigin())
  .use(derive(async () => ({ access: await currentAccess() })))
  .use(withServices(consent));
