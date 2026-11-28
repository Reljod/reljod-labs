import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CHECK_IDS, METRIC_IDS } from "../domain/contract";
import { type LoupeClaims, readLoupeToken, signLoupeToken } from "./mcp-token";

vi.mock("server-only", () => ({}));

const SECRET = "test-salt";
const HOST = "host:11111111-1111-4111-8111-111111111111";
const future = Math.floor(Date.now() / 1000) + 600;

describe("a Loupe MCP token", () => {
  const host: LoupeClaims = {
    kind: "host",
    owner: HOST as LoupeClaims["owner"],
    visitor: "v",
    email: "host@example.test",
    exp: future,
  };

  it("round-trips, and is refused when altered, expired or signed with another secret", () => {
    const token = signLoupeToken(host, SECRET);
    expect(readLoupeToken(token, SECRET)).toEqual(host);
    expect(readLoupeToken(token, "other")).toBeNull();
    expect(readLoupeToken(`${token}x`, SECRET)).toBeNull();
    expect(
      readLoupeToken(token.replace("loupe_", "sieve_"), SECRET),
    ).toBeNull();
    expect(readLoupeToken(token, SECRET, (future + 1) * 1000)).toBeNull();
  });

  it("refuses claims whose Owner does not match their kind", () => {
    const sign = (claims: LoupeClaims) =>
      readLoupeToken(signLoupeToken(claims, SECRET), SECRET);
    expect(sign({ ...host, kind: "e2e" })).toBeNull();
    expect(
      sign({
        ...host,
        kind: "guest",
        pass: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBeNull();
    expect(sign({ ...host, owner: "nobody" as never })).toBeNull();
    // An Examiner token is bound to one Examination.
    expect(sign({ ...host, kind: "examiner" })).toBeNull();
    expect(
      sign({ ...host, kind: "examiner", examinationId: "not-a-uuid" }),
    ).toBeNull();
    expect(
      sign({
        ...host,
        kind: "examiner",
        examinationId: "33333333-3333-4333-8333-333333333333",
      })?.kind,
    ).toBe("examiner");
  });
});

describe("the Toolkit and the contract agree", () => {
  const python = readFileSync(
    join(process.cwd(), "src/features/loupe/toolkit/loupe/contract.py"),
    "utf8",
  );
  it("knows every Metric and every Check by the same id", () => {
    for (const id of METRIC_IDS) expect(python).toContain(`"${id}"`);
    for (const id of CHECK_IDS) expect(python).toContain(`"${id}"`);
  });
});
