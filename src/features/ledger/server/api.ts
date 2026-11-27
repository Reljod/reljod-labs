import "server-only";
import { z } from "zod";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api, derive } from "@/platform/http/pipeline";
import { FORCE_LIMIT_HEADER } from "../domain/api";
import { ledger } from "./container";
import type { Caller } from "./ports";
import type { Ask } from "./service";

/**
 * Ledger's base route stack: same-origin writes, the Access gate and the
 * Owner, the visitor hash its caps count against, its service, `caller`, and
 * `ask`: the e2e suite's forced limit, honoured only with the e2e token.
 */
export const ledgerApi = api("ledger")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(ledger))
  .use(
    derive(({ owner, visitor, mode, request }) => ({
      caller: { owner, visitor } satisfies Caller as Caller,
      ask: {
        forceLimit: mode.e2e && request.headers.get(FORCE_LIMIT_HEADER) === "1",
      } satisfies Ask as Ask,
    })),
  );

/** `[id]`: an Ask session id; a malformed one is a session that is not there. */
export const sessionPath = z.object({ id: z.string() });
