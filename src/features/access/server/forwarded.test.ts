import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { forwardAccess, forwardedAccess } from "./forwarded";

const host = {
  kind: "host" as const,
  userId: "6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c",
  email: "host@example.com",
  name: "",
};

beforeEach(() => {
  vi.stubEnv(
    "RATE_LIMIT_SALT",
    "a-salt-that-is-at-least-thirty-two-characters",
  );
});

describe("the Access the proxy forwards", () => {
  it("is read back while fresh", () => {
    const now = 1_000_000;
    expect(forwardedAccess(forwardAccess(host, now), now + 1_000)).toEqual(
      host,
    );
  });

  it("is refused once expired, so a captured value cannot be replayed", () => {
    const now = 1_000_000;
    expect(
      forwardedAccess(forwardAccess(host, now), now + 31_000),
    ).toBeUndefined();
  });

  it("is refused when the browser forges or edits it", () => {
    const now = Date.now();
    const [payload, signature] = forwardAccess(host, now).split(".");
    const asGuest = Buffer.from(
      JSON.stringify({ access: { ...host, kind: "e2e" }, exp: now + 30_000 }),
    ).toString("base64url");
    expect(forwardedAccess(`${asGuest}.${signature}`)).toBeUndefined();
    expect(forwardedAccess(`${payload}.${signature}.x`)).toBeUndefined();
    expect(forwardedAccess(`${payload}.`)).toBeUndefined();
    expect(forwardedAccess("e2e")).toBeUndefined();
  });
});
