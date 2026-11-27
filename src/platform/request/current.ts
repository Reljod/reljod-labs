import "server-only";
import { headers } from "next/headers";
import { modeOf, type RequestMode } from "./mode";
import { type Visitor, visitorOf } from "./visitor";

/**
 * The mode and visitor of the request being rendered, for a page's server
 * component, which reads its first view through the same services as the
 * REST routes (route handlers get both from the pipeline instead).
 */
export async function currentRequest(): Promise<{
  mode: RequestMode;
  visitor: Visitor;
}> {
  const requestHeaders = await headers();
  const mode = modeOf(requestHeaders);
  return { mode, visitor: visitorOf(requestHeaders, mode) };
}
