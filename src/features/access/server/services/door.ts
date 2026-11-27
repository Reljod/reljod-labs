import "server-only";
import { LimitError, UnauthorizedError } from "@/platform/errors";
import type { Visitor } from "@/platform/request/visitor";
import { ACCESS_PATH, PROFILE_PATH } from "../../constants";
import type { Destination, Profile } from "../../domain/api";
import { normalizeGuestCode } from "../../domain/guest-code";
import { safeNextPath } from "../../domain/guest-pass";
import { UnavailableError } from "../errors";
import type { Access } from "../gate";
import type { AccessPorts, Browser } from "../ports";
import { codeHashOf, WAIT } from "./common";

const BAD_CODE =
  "That code did not open the door. It may be mistyped, expired, or already in use on as many devices as it allows.";
const WRONG_PASSWORD = "Wrong email or password.";

/**
 * The door: who this browser is, a Host's sign-in, a Guest code, and the way
 * out. Every try at a code or a password is counted before it is checked
 * (`takeAttempt` records it as failed under a lock) and settled only once it
 * worked, so a burst of guesses cannot slip past the cap.
 */
export interface DoorService {
  /** Who this browser is, for the profile menu; keeps the profile hint in step. */
  whoIs(browser: Browser, access: Access | null): Promise<Profile>;
  /** A Guest enters a code: this browser becomes a Guest on that pass. */
  redeem(
    browser: Browser,
    caller: { access: Access | null; visitor: Visitor },
    input: { code: string; next?: string | null },
  ): Promise<Destination>;
  /** A Host signs in with their Supabase Auth account. */
  signIn(
    browser: Browser,
    visitor: Visitor,
    input: { email: string; password: string; next?: string | null },
  ): Promise<Destination>;
  /** Ends this browser's session, Host or Guest. */
  signOut(browser: Browser): Promise<Destination>;
}

export function createDoorService(
  ports: Pick<AccessPorts, "door" | "analytics" | "authReady">,
): DoorService {
  const { door, analytics } = ports;

  return {
    async whoIs(browser, access) {
      if (access?.kind === "host") {
        await browser.hint("host");
        return { kind: "host", email: access.email, name: access.name };
      }
      if (access?.kind === "guest") {
        await browser.hint("guest");
        return {
          kind: "guest",
          label: access.label,
          expiresAt: access.expiresAt,
        };
      }
      if (!access) await browser.hint(null);
      return null;
    },

    async redeem(browser, { access, visitor }, input) {
      const next = safeNextPath(input.next);
      // A Host (or the e2e suite) needs no code.
      if (access && access.kind !== "guest") return { to: next };

      // Counted as a wrong try from here on, unless it works (settleAttempt).
      const attempt = await door.takeAttempt(visitor.hash, "code");
      if (attempt === null) throw new LimitError(WAIT);
      const code = normalizeGuestCode(input.code);
      if (!code) throw new UnauthorizedError(BAD_CODE);
      if (!ports.authReady()) {
        console.error("[access] SUPABASE_PUBLISHABLE_KEY is not set");
        await door.releaseAttempt(attempt);
        throw new UnavailableError("Guest access is not set up yet.");
      }

      const codeHash = codeHashOf(code);
      const claims = await browser.claims();
      const returning = claims?.anonymous ? claims.userId : null;

      // Looked up before anything is created, so a wrong code makes no Auth user.
      if (!(await door.codeLooksGood(codeHash, returning)))
        throw new UnauthorizedError(BAD_CODE);

      let userId = returning;
      if (!userId) {
        userId = await browser.signInAnonymously();
        if (!userId) {
          await door.releaseAttempt(attempt);
          throw new UnavailableError(
            "Guest access is not available right now. Try again soon.",
          );
        }
      }

      const pass = await door.redeem({
        codeHash,
        userId,
        visitorHash: visitor.hash,
      });
      if (!pass) {
        // Lost a race for the last device, or the pass ended a moment ago.
        if (!returning) {
          await browser.signOut();
          await door.deleteGuest(userId);
        }
        throw new UnauthorizedError(BAD_CODE);
      }
      await door.settleAttempt(attempt);
      await browser.hint("guest");
      await analytics.track("Guest code redeemed", {
        audience: "guest",
        returning: returning !== null,
      });
      return { to: next };
    },

    async signIn(browser, visitor, input) {
      const email = input.email.trim();
      if (!email || !input.password)
        throw new UnauthorizedError(WRONG_PASSWORD);
      if (!ports.authReady()) {
        console.error("[access] SUPABASE_PUBLISHABLE_KEY is not set");
        throw new UnavailableError("Sign-in is not set up yet.");
      }

      const attempt = await door.takeAttempt(visitor.hash, "sign_in");
      if (attempt === null) throw new LimitError(WAIT);

      const accepted = await browser.signInWithPassword(email, input.password);
      // An account that is not a Host is told the same thing as a wrong password.
      const host = accepted ? await browser.host() : null;
      if (!host) {
        if (accepted) await browser.signOut();
        throw new UnauthorizedError(WRONG_PASSWORD);
      }
      await door.settleAttempt(attempt);
      await browser.hint("host");
      await analytics.track("Host signed in", { audience: "host" });
      // Sent here from a demo (an MCP client's sign-in, say): go back to it.
      return { to: input.next ? safeNextPath(input.next) : PROFILE_PATH };
    },

    async signOut(browser) {
      if (ports.authReady()) {
        // A Guest who leaves gives their device back to the pass. Their saved
        // data stays: it belongs to the pass, not to this browser.
        const claims = await browser.claims();
        if (claims?.anonymous) {
          try {
            await door.endGuestSession(claims.userId);
          } catch (error) {
            console.error("[access] could not free the Guest's device", error);
          }
        }
        await browser.signOut();
      }
      await browser.hint(null);
      return { to: ACCESS_PATH };
    },
  };
}
