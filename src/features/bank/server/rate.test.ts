import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("./db", () => ({ sql: vi.fn() }));
vi.mock("./env", () => ({
  env: { e2eBypassToken: () => "", rateLimitSalt: () => "salt" },
}));

const { isE2eToken } = await import("./rate");

describe("the e2e bypass token", () => {
  it("passes only the exact token, and nothing when none is configured", () => {
    expect(isE2eToken("secret-token", "secret-token")).toBe(true);
    expect(isE2eToken("secret-tokem", "secret-token")).toBe(false);
    expect(isE2eToken("secret", "secret-token")).toBe(false);
    expect(isE2eToken("secret-token-and-more", "secret-token")).toBe(false);
    expect(isE2eToken(null, "secret-token")).toBe(false);
    expect(isE2eToken("", "")).toBe(false);
    // The configured token (none here) is the default.
    expect(isE2eToken("anything")).toBe(false);
  });
});
