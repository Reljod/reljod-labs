import { describe, expect, it } from "vitest";
import {
  guestTokenProblem,
  type McpClaims,
  readMcpToken,
  signMcpToken,
} from "./mcp-token";

const claims: McpClaims = {
  kind: "guest",
  owner: "guest:4b7f0c1e-0000-4000-8000-000000000001",
  visitor: "hash",
  user: "user-1",
  pass: "pass-1",
  exp: Math.floor(Date.UTC(2030, 0, 1) / 1000),
};
const now = Date.UTC(2026, 10, 14);

describe("MCP tokens", () => {
  it("reads back what it signed", () => {
    const token = signMcpToken(claims, "salt");
    expect(token.startsWith("cmm_")).toBe(true);
    expect(readMcpToken(token, "salt", now)).toEqual(claims);
  });

  it("refuses another secret, a changed payload and an expired token", () => {
    const token = signMcpToken(claims, "salt");
    expect(readMcpToken(token, "other", now)).toBeNull();
    const [payload, signature] = token.slice(4).split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...claims,
        owner: "guest:4b7f0c1e-0000-4000-8000-000000000002",
      }),
    ).toString("base64url");
    expect(readMcpToken(`cmm_${forged}.${signature}`, "salt", now)).toBeNull();
    expect(
      readMcpToken(`cmm_${payload}.${signature}`, "salt", now),
    ).not.toBeNull();
    expect(readMcpToken(token, "salt", Date.UTC(2031, 0, 1))).toBeNull();
  });

  it("refuses a token minted before Owners, which named a browser session", () => {
    const { owner: _owner, ...rest } = claims;
    const legacy = signMcpToken(
      { ...rest, session: "4b7f0c1e-0000-4000-8000-000000000001" } as never,
      "salt",
    );
    expect(readMcpToken(legacy, "salt", now)).toBeNull();
  });

  it("refuses anything that is not one of its tokens", () => {
    expect(readMcpToken("", "salt", now)).toBeNull();
    expect(readMcpToken("Bearer abc", "salt", now)).toBeNull();
    expect(readMcpToken("cmm_onlyonepart", "salt", now)).toBeNull();
  });
});

describe("guest token beside an OAuth sign-in", () => {
  const oauth: McpClaims = { ...claims, via: "oauth" };
  const pasted = signMcpToken(claims, "salt");

  it("asks an OAuth Guest for their guest token of the same pass", () => {
    expect(guestTokenProblem(oauth, null, "salt", now)).toMatch(
      /X-Guest-Token/,
    );
    expect(guestTokenProblem(oauth, pasted, "salt", now)).toBeNull();
  });

  it("refuses another pass's token, an OAuth token or a forged one", () => {
    const otherPass = signMcpToken({ ...claims, pass: "pass-2" }, "salt");
    expect(guestTokenProblem(oauth, otherPass, "salt", now)).not.toBeNull();
    const oauthToken = signMcpToken(oauth, "salt");
    expect(guestTokenProblem(oauth, oauthToken, "salt", now)).not.toBeNull();
    expect(
      guestTokenProblem(oauth, signMcpToken(claims, "other"), "salt", now),
    ).not.toBeNull();
  });

  it("asks nothing of Hosts or pasted guest tokens", () => {
    expect(guestTokenProblem(claims, null, "salt", now)).toBeNull();
    const host: McpClaims = {
      kind: "host",
      owner: "host:4b7f0c1e-0000-4000-8000-000000000009",
      visitor: "hash",
      email: "host@example.com",
      via: "oauth",
      exp: claims.exp,
    };
    expect(guestTokenProblem(host, null, "salt", now)).toBeNull();
  });
});
