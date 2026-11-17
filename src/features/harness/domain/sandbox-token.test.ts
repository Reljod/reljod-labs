import { describe, expect, it } from "vitest";
import { sandboxOwnerTag, signSandboxToken } from "./sandbox-token";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("signSandboxToken", () => {
  it("reproduces the Runner's test vector", () => {
    expect(
      signSandboxToken(SECRET, {
        sid: "123e4567-e89b-42d3-a456-426614174000",
        exp: 1800000000,
        act: "run",
      }),
    ).toBe(
      "eyJzaWQiOiIxMjNlNDU2Ny1lODliLTQyZDMtYTQ1Ni00MjY2MTQxNzQwMDAiLCJleHAiOjE4MDAwMDAwMDAsImFjdCI6InJ1biJ9.x4d1b-3_LfP2u9e6oBe0EiThcaQkgAljs49d_G9LxTU",
    );
  });

  it("reproduces the Runner's test vector with an Owner tag", () => {
    expect(
      signSandboxToken(SECRET, {
        sid: "123e4567-e89b-42d3-a456-426614174000",
        exp: 1800000000,
        act: "run",
        own: "b3duZXItdGFnLWV4YW1wbGU",
      }),
    ).toBe(
      "eyJzaWQiOiIxMjNlNDU2Ny1lODliLTQyZDMtYTQ1Ni00MjY2MTQxNzQwMDAiLCJleHAiOjE4MDAwMDAwMDAsImFjdCI6InJ1biIsIm93biI6ImIzZHVaWEl0ZEdGbkxXVjRZVzF3YkdVIn0.7XEN7OKKp6e9YdWJohcCNJSW9X1jWfsidZXDyfOBbR0",
    );
  });
});

describe("sandboxOwnerTag", () => {
  it("is stable, opaque and the shape the Runner accepts", () => {
    const owner = "host:00000000-0000-4000-8000-000000000001";
    const tag = sandboxOwnerTag(SECRET, owner);
    expect(tag).toBe("mXtOEr4rvzlSWaBEf1uzvl");
    expect(tag).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(tag).not.toContain("host");
    expect(sandboxOwnerTag(SECRET, "guest:other")).not.toBe(tag);
    expect(sandboxOwnerTag(`${SECRET}x`, owner)).not.toBe(tag);
  });
});
