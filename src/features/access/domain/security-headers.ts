/**
 * Response headers for every page and route (next.config.ts `headers`).
 *
 * No page of the site is meant to be framed by anyone, itself included, so a
 * click on a demo or on an OAuth consent page cannot be stolen by a page that
 * frames it. The one iframe the app draws (a Canvas View) is a sandboxed
 * `srcdoc` frame: the page fetches the App's document from
 * `/api/canvas/app/frame` and writes it into the frame, so no URL of this
 * site is ever loaded as a frame. That route sets its own
 * Content-Security-Policy, Referrer-Policy and nosniff (ADR 0031), so it is
 * left out of the entry that sets those, and gets only the headers it lacks.
 * A future page that must be framed by the site itself gets an entry of its
 * own with `frame-ancestors 'self'` and `SAMEORIGIN`, left out here the same way.
 *
 * Not yet: a script Content-Security-Policy. Next's inline scripts need a
 * nonce from the proxy for one, which is its own change (follow-up).
 */

/** Paths that set their own policy headers; the site-wide set skips them. */
export const OWN_POLICY_PATHS = ["/api/canvas/app/frame"] as const;

const NOT_FRAMED = [
  { key: "X-Frame-Options", value: "DENY" },
  // Two years; no includeSubDomains, so no other host under the domain is bound.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const POLICIES = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** `/:path(...)` matching every path, `/` included, except the given ones. */
export function everyPathExcept(paths: readonly string[]) {
  const skipped = paths.map((path) => `${path.slice(1)}$`).join("|");
  return `/:path((?!${skipped}).*)`;
}

export function securityHeaders() {
  return [
    {
      source: everyPathExcept(OWN_POLICY_PATHS),
      headers: [...NOT_FRAMED, ...POLICIES],
    },
    ...OWN_POLICY_PATHS.map((source) => ({ source, headers: NOT_FRAMED })),
  ];
}
