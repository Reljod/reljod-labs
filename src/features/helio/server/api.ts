import "server-only";
import {
  sameOrigin,
  withAccess,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api } from "@/platform/http/pipeline";
import { helio } from "./container";

/**
 * The largest body a Helio route reads: Vercel's own 4.5 MB request cap.
 * The images inside are bounded again, one by one and together
 * (`LIMITS.maxUploadBytes`, `LIMITS.maxRequestImagesBytes`).
 */
export const HELIO_BODY_LIMIT = 4.5 * 1024 * 1024;

/**
 * Helio's base route stack: same-origin writes, the Access gate (Helio
 * saves nothing, so no Owner), the visitor hash its caps count against, and
 * its service. Each route adds its own body layer.
 */
export const helioApi = api("helio")
  .use(sameOrigin())
  .use(withAccess())
  .use(withVisitor())
  .use(withServices(helio));
