import "server-only";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api } from "@/platform/http/pipeline";
import { floorwalk } from "./container";

/**
 * Floorwalk's base route stack: same-origin writes, the Access gate and the
 * Owner, the visitor hash its caps count against, and its service. Each
 * route adds its own body or query layer.
 */
export const floorwalkApi = api("floorwalk")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(floorwalk));
