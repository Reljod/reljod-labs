import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isE2eToken } = await import("./e2e");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isE2eToken", () => {
  it("matches only the configured token", () => {
    vi.stubEnv("E2E_BYPASS_TOKEN", "secret-token");
    expect(isE2eToken("secret-token")).toBe(true);
    expect(isE2eToken("secret-tokeN")).toBe(false);
    expect(isE2eToken("secret")).toBe(false);
    expect(isE2eToken(null)).toBe(false);
    expect(isE2eToken("")).toBe(false);
  });

  it("never matches when no token is configured", () => {
    vi.stubEnv("E2E_BYPASS_TOKEN", "");
    expect(isE2eToken("")).toBe(false);
    expect(isE2eToken("anything")).toBe(false);
  });
});
