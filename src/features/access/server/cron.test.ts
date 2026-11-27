import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { cronAuthorized } = await import("./cron");

describe("cronAuthorized", () => {
  const secret = "s3cret-value-for-the-cron-route";

  it("lets the right bearer through", () => {
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });

  it.each([
    null,
    "",
    secret,
    `Bearer ${secret}x`,
    `Bearer ${secret.slice(1)}`,
    `bearer ${secret}`,
    "Bearer ",
  ])("refuses %j", (header) => {
    expect(cronAuthorized(header, secret)).toBe(false);
  });

  it("fails closed when the secret is unset", () => {
    expect(cronAuthorized("Bearer ", "")).toBe(false);
    expect(cronAuthorized("Bearer undefined", "")).toBe(false);
  });
});
