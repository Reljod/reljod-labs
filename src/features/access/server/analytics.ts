import "server-only";
import { track } from "@vercel/analytics/server";
import type { Audience } from "../domain/audience";

/**
 * Records a sign-in at the door as a Web Analytics custom event. Best effort:
 * analytics never stands between a visitor and the demos. Never send an email,
 * a name or a Guest pass label: the event properties are not private.
 */
export async function trackAccess(
  event: "Host signed in" | "Guest code redeemed",
  properties: { audience: Exclude<Audience, "visitor">; returning?: boolean },
) {
  try {
    await track(event, properties);
  } catch (error) {
    console.error("[access] could not record an analytics event", error);
  }
}
