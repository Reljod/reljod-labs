import "server-only";
import { ForbiddenError, InvalidError, LimitError } from "@/platform/errors";
import type { Visitor } from "@/platform/request/visitor";
import type { Saved } from "../../domain/api";
import {
  LIMITS,
  parseDisplayName,
  passwordProblem,
} from "../../domain/guest-pass";
import { UnavailableError } from "../errors";
import type { Access } from "../gate";
import type { AccessPorts, Browser } from "../ports";
import { asHost, WAIT } from "./common";

/** A Host's Profile settings: the name they are shown by, and their password. */
export interface ProfileService {
  rename(access: Access | null, browser: Browser, name: string): Promise<Saved>;
  /** Proves the current password first: a stolen session must not be enough to take the account over. */
  changePassword(
    access: Access | null,
    browser: Browser,
    visitor: Visitor,
    input: { current: string; next: string; confirm: string },
  ): Promise<Saved>;
}

export function createProfileService(
  ports: Pick<AccessPorts, "door" | "passwords">,
): ProfileService {
  return {
    async rename(access, browser, input) {
      asHost(access);
      const name = parseDisplayName(input);
      if (name === null)
        throw new InvalidError(`Use at most ${LIMITS.nameLength} characters.`);
      if (!(await browser.setDisplayName(name)))
        throw new UnavailableError(
          "The profile could not be saved. Try again.",
        );
      return { saved: "Profile saved." };
    },

    async changePassword(access, browser, visitor, input) {
      const host = asHost(access);
      const problem = passwordProblem(input);
      if (problem) throw new InvalidError(problem);

      const attempt = await ports.door.takeAttempt(visitor.hash, "sign_in");
      if (attempt === null) throw new LimitError(WAIT);
      if (!(await ports.passwords.verify(host.email, input.current)))
        throw new ForbiddenError("The current password is wrong.");
      await ports.door.settleAttempt(attempt);

      const changed = await browser.setPassword(input.next);
      if (changed === "weak")
        throw new InvalidError(
          "That password is too weak. Choose a stronger one.",
        );
      if (changed === "failed")
        throw new UnavailableError(
          "The password could not be changed. Try again.",
        );
      return { saved: "Password changed." };
    },
  };
}
