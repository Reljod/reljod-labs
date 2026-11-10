/**
 * Which group a browser falls in, for Web Analytics only: a Host, a Guest, or
 * a visitor who has not signed in. It is read from the profile hint cookie,
 * which carries no authority, so it groups traffic and decides nothing.
 */
export type Audience = "host" | "guest" | "visitor";

/** The flag every pageview carries, so the dashboard can filter by it. */
export const AUDIENCE_FLAG = "audience";

/**
 * The Audience a profile hint names. A hint from before it named the kind
 * ("1") means someone signed in, but not who, so it counts as a visitor until
 * the profile menu rewrites it.
 */
export function audienceFromHint(hint: string | null | undefined): Audience {
  return hint === "host" || hint === "guest" ? hint : "visitor";
}

/** The value of one cookie in a `document.cookie` string. */
export function cookieValue(jar: string, name: string): string | null {
  for (const pair of jar.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
