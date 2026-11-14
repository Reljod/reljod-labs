import { describe, expect, it } from "vitest";
import { type McpClaims, readMcpToken, signMcpToken } from "./mcp-token";

const claims: McpClaims = {
  kind: "guest",
  session: "4b7f0c1e-0000-4000-8000-000000000001",
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
      JSON.stringify({ ...claims, session: "someone-else" }),
    ).toString("base64url");
    expect(readMcpToken(`cmm_${forged}.${signature}`, "salt", now)).toBeNull();
    expect(
      readMcpToken(`cmm_${payload}.${signature}`, "salt", now),
    ).not.toBeNull();
    expect(readMcpToken(token, "salt", Date.UTC(2031, 0, 1))).toBeNull();
  });

  it("refuses anything that is not one of its tokens", () => {
    expect(readMcpToken("", "salt", now)).toBeNull();
    expect(readMcpToken("Bearer abc", "salt", now)).toBeNull();
    expect(readMcpToken("cmm_onlyonepart", "salt", now)).toBeNull();
  });
});
