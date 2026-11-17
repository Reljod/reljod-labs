import { describe, expect, it } from "vitest";
import { signSandboxToken } from "./sandbox-token";

describe("signSandboxToken", () => {
  it("reproduces the Runner's test vector", () => {
    expect(
      signSandboxToken("0123456789abcdef0123456789abcdef", {
        sid: "123e4567-e89b-42d3-a456-426614174000",
        exp: 1800000000,
        act: "run",
      }),
    ).toBe(
      "eyJzaWQiOiIxMjNlNDU2Ny1lODliLTQyZDMtYTQ1Ni00MjY2MTQxNzQwMDAiLCJleHAiOjE4MDAwMDAwMDAsImFjdCI6InJ1biJ9.x4d1b-3_LfP2u9e6oBe0EiThcaQkgAljs49d_G9LxTU",
    );
  });
});
