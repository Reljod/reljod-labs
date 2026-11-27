import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { OWN_POLICY_PATHS, securityHeaders } from "./security-headers";

// The matcher Next uses for `headers()` sources (it ships no types).
const { match } = createRequire(import.meta.url)(
  "next/dist/compiled/path-to-regexp",
) as { match: (source: string) => (path: string) => unknown };

function headersFor(path: string) {
  const found = new Map<string, string>();
  for (const entry of securityHeaders()) {
    if (!match(entry.source)(path)) continue;
    for (const { key, value } of entry.headers) found.set(key, value);
  }
  return found;
}

describe("security headers", () => {
  it.each([
    "/",
    "/about",
    "/demos/canvas",
    "/demos/client-manager/mcp/authorize",
    "/demos/harness/mcp/authorize",
    "/access/sign-in",
    "/api/canvas/app/frame/other",
  ])("forbids framing %s and sets the policy headers", (path) => {
    const headers = headersFor(path);
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'none'",
    );
    expect(headers.get("Strict-Transport-Security")).toMatch(/^max-age=\d+/);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it.each(
    OWN_POLICY_PATHS,
  )("leaves %s its own policy headers, and still forbids framing", (path) => {
    const headers = headersFor(path);
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.has("Content-Security-Policy")).toBe(false);
    expect(headers.has("Referrer-Policy")).toBe(false);
  });
});
