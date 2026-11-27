import "server-only";
import {
  sameOrigin,
  withAccess,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api } from "@/platform/http/pipeline";
import { vellum } from "./container";

/**
 * Vellum's base route stack: same-origin writes, the Access gate (Vellum
 * saves nothing, so no Owner), the visitor hash its caps count against, and
 * its service.
 */
export const vellumApi = api("vellum")
  .use(sameOrigin())
  .use(withAccess())
  .use(withVisitor())
  .use(withServices(vellum));
