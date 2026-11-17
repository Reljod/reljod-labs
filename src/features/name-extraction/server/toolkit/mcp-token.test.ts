import { describe, expect, it } from "vitest";
import { readSieveToken, signSieveToken } from "./mcp-token";

const SECRET = "test-salt";
const PASS = "0b8f3c1e-6f7e-4f9a-9a77-1f2d3c4b5a69";
const exp = Math.floor(Date.now() / 1000) + 3600;

describe("Sieve MCP tokens", () => {
  it("round-trips a Guest token", () => {
    const token = signSieveToken(
      {
        kind: "guest",
        owner: `guest:${PASS}`,
        visitor: "v",
        user: "u",
        pass: PASS,
        exp,
      },
      SECRET,
    );
    expect(readSieveToken(token, SECRET)?.owner).toBe(`guest:${PASS}`);
  });

  it("refuses a token signed with another secret, tampered, or expired", () => {
    const token = signSieveToken(
      { kind: "e2e", owner: "e2e", visitor: "v", exp },
      SECRET,
    );
    expect(readSieveToken(token, "other")).toBeNull();
    const [payload, signature] = token.slice("sieve_".length).split(".");
    const forged = Buffer.from(
      JSON.stringify({
        kind: "host",
        owner: `host:${PASS}`,
        visitor: "v",
        exp,
      }),
    ).toString("base64url");
    expect(readSieveToken(`sieve_${forged}.${signature}`, SECRET)).toBeNull();
    expect(
      readSieveToken(`sieve_${payload}.${signature}`, SECRET, (exp + 1) * 1000),
    ).toBeNull();
  });

  it("refuses a Guest token whose Owner is not its pass", () => {
    const token = signSieveToken(
      {
        kind: "guest",
        owner: `host:${PASS}`,
        visitor: "v",
        user: "u",
        pass: PASS,
        exp,
      },
      SECRET,
    );
    expect(readSieveToken(token, SECRET)).toBeNull();
  });
});
