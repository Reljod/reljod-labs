import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({ env: { rateLimitSalt: () => "test-salt" } }));

import {
  ownerMatches,
  SESSION_TOKEN_SECONDS,
  sessionToken,
  verifySessionToken,
} from "./session";

const OWNER = "host:4b7f0c1e-0000-4000-8000-000000000001" as const;
const OTHER = "guest:4b7f0c1e-0000-4000-8000-000000000002" as const;
const NOW = Date.UTC(2026, 10, 27, 12);
const desk = { id: "desk-1", owner: OWNER };

describe("the Casework MCP session token", () => {
  it("names its Desk, its Owner and when it ends", () => {
    expect(verifySessionToken(sessionToken(desk, NOW), NOW)).toEqual({
      sessionId: "desk-1",
      owner: OWNER,
      exp: Math.floor(NOW / 1000) + SESSION_TOKEN_SECONDS,
    });
  });

  it("expires", () => {
    const token = sessionToken(desk, NOW);
    const later = NOW + SESSION_TOKEN_SECONDS * 1000;
    expect(verifySessionToken(token, later)).toBeNull();
  });

  it("refuses an edited payload, another secret and the old unsigned-owner form", () => {
    const token = sessionToken(desk, NOW);
    const [payload, signature] = token.slice("cws1.".length).split(".");
    const edited = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString(),
    );
    edited.owner = OTHER;
    const forged = `cws1.${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${signature}`;
    expect(verifySessionToken(forged, NOW)).toBeNull();
    expect(
      verifySessionToken(sessionToken(desk, NOW, "other-salt"), NOW),
    ).toBeNull();
    // Before: `<session id>.<hmac>`, with no Owner and no expiry.
    expect(verifySessionToken(`desk-1.${signature}`, NOW)).toBeNull();
  });

  it("acts only on a Desk still owned by the token's Owner", () => {
    expect(ownerMatches(OWNER, OWNER)).toBe(true);
    expect(ownerMatches(OTHER, OWNER)).toBe(false);
    expect(ownerMatches(OWNER, null)).toBe(false);
    expect(ownerMatches(OWNER, undefined)).toBe(false);
    // The outside client's desk has no Owner.
    expect(ownerMatches(null, null)).toBe(true);
    expect(ownerMatches(null, undefined)).toBe(false);
  });
});
