import "server-only";
import { z } from "zod";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api, derive } from "@/platform/http/pipeline";
import { switchboard } from "./container";
import type { Caller } from "./ports";

/**
 * Switchboard's base route stack: same-origin writes, the Access gate and the
 * Owner, the visitor hash its caps count against, its services, and the
 * Owner's Workspace (made and seeded on first use) with `caller`, who every
 * service call is made for. Each route adds its own body, query or path layer.
 */
export const switchboardApi = api("switchboard")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(switchboard))
  .use(
    derive(async ({ owner, visitor, services }) => {
      await services.office.ensure(owner);
      return { caller: { owner, visitor } satisfies Caller as Caller };
    }),
  );

/** `[id]`: a Call id. A malformed one is a Call that is not there. */
export const callPath = z.object({ id: z.string() });

/** `[id]`: a Rule id. */
export const rulePath = z.object({ id: z.string().max(60) });
