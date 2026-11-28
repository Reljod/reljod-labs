import "server-only";
import { z } from "zod";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api, derive } from "@/platform/http/pipeline";
import { loupe } from "./container";
import type { Who } from "./ports";

/**
 * Where the request came in, for a Sample's file (`sample-files.ts` uses it
 * only when it names this deployment or, in development, a local server).
 */
function originOf(headers: Headers): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "";
  const proto =
    headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.")
      ? "http"
      : "https");
  return host ? `${proto}://${host}` : "";
}

/**
 * Loupe's base route stack: same-origin writes, the Access gate and the
 * Owner, the visitor hash its caps count against, its services, and `who`,
 * the app caller every service call is made for. Each route adds its own
 * body, query or path layer.
 */
export const loupeApi = api("loupe")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(loupe))
  .use(
    derive(({ owner, visitor, request }) => ({
      who: {
        owner,
        visitor,
        origin: originOf(request.headers),
        via: "app",
      } satisfies Who as Who,
    })),
  );

/** `[id]`: an Examination id, a uuid. */
export const examinationPath = z.object({ id: z.string().uuid() });
