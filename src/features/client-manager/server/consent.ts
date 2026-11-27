import "server-only";
import { callbackVouched } from "@/features/access/domain/mcp-clients";
import { AccessDeniedError } from "@/features/access/server/errors";
import type { Access } from "@/features/access/server/gate";
import { InvalidError, UnauthorizedError } from "@/platform/errors";
import type { ConsentAnswer } from "../domain/consent";
import {
  approvedRedirect,
  errorRedirect,
  type Grant,
  parseAuthorizationRequest,
} from "../domain/oauth";

const ENDED = "Your access has ended. Sign in again, then retry.";

export type ConsentPorts = {
  /** Signs the authorization code (`RATE_LIMIT_SALT`). */
  secret: () => string;
  /** The Grant of whoever is signed in now; throws AccessDeniedError once their Access ended. */
  grant: () => Promise<Grant>;
  now: () => number;
};

/**
 * The consent page's Allow and Deny. Both answer with where the browser goes:
 * the client's callback, with a code or an error. Nothing is redirected
 * anywhere for a visitor without Access, so the answer is no open redirect.
 * A callback that is neither loopback nor a known client's needs the person
 * to have ticked "I trust <host>". Allow mints the code from the Grant of
 * whoever is signed in now.
 */
export interface ConsentService {
  answer(access: Access | null, input: ConsentAnswer): Promise<{ to: string }>;
}

export function createConsentService(ports: ConsentPorts): ConsentService {
  return {
    async answer(access, input) {
      if (!access) throw new UnauthorizedError(ENDED);
      const secret = ports.secret();
      const parsed = parseAuthorizationRequest(
        new URLSearchParams(input.request),
        secret,
      );
      if (parsed.kind === "invalid") throw new InvalidError(parsed.message);
      if (parsed.kind === "error") return { to: parsed.redirect };
      const { request } = parsed;
      if (input.answer !== "allow")
        return {
          to: errorRedirect(
            request.redirectUri,
            request.state,
            "access_denied",
            "The person said no.",
          ),
        };
      if (!callbackVouched(request.redirectUri, input.trustHost))
        throw new InvalidError(
          `Tick "I trust ${new URL(request.redirectUri).host}" first, or Deny.`,
        );
      let grant: Grant;
      try {
        grant = await ports.grant();
      } catch (error) {
        if (error instanceof AccessDeniedError)
          throw new UnauthorizedError(ENDED);
        throw error;
      }
      return { to: approvedRedirect(request, grant, secret, ports.now()) };
    },
  };
}
