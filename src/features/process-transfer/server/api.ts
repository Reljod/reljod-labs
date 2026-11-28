import "server-only";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api } from "@/platform/http/pipeline";
import { handover } from "./container";

/**
 * Handover's base route stack: same-origin writes, the Access gate and the
 * Owner every Run, Rule and Audit line is scoped to, the visitor hash the
 * hourly cap counts, and its services. Each route adds its own body, query
 * or path layer.
 */
export const handoverApi = api("process-transfer")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(handover));

/** The request's host, for where a Sample is fetched from (`siteOrigin` decides whether to trust it). */
export function hostOf(request: Request): string {
  return (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? ""
  );
}
