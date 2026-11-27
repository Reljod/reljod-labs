import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function freshEnv() {
  vi.resetModules();
  return import("./env");
}

describe("RATE_LIMIT_SALT", () => {
  it("warns once, and does not throw, when the salt is short", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("RATE_LIMIT_SALT", "short");
    const { env } = await freshEnv();
    expect(env.rateLimitSalt()).toBe("short");
    expect(env.rateLimitSalt()).toBe("short");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("RATE_LIMIT_SALT");
    expect(String(warn.mock.calls[0][0])).not.toContain("short");
  });

  it("stays quiet for a long salt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("RATE_LIMIT_SALT", "x".repeat(32));
    const { env } = await freshEnv();
    env.rateLimitSalt();
    expect(warn).not.toHaveBeenCalled();
  });

  it("still throws when it is missing", async () => {
    vi.stubEnv("RATE_LIMIT_SALT", "");
    const { env } = await freshEnv();
    expect(() => env.rateLimitSalt()).toThrow("RATE_LIMIT_SALT");
  });
});
