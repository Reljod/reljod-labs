import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyEvents, assetUrl, emptyView } from "../components/view";
import { CHECK_IDS, METRIC_IDS, type StoredEvent } from "../domain/contract";
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

describe("the page's view of a Trail", () => {
  const events = [
    { seq: 1, at: 1, type: "thought", text: "Looking." },
    {
      seq: 2,
      at: 2,
      type: "tool",
      callId: "c1",
      tool: "look",
      summary: "page 1",
      input: {},
      state: "start",
    },
    { seq: 3, at: 3, type: "look", callId: "c1", page: 1, box: null },
    {
      seq: 4,
      at: 4,
      type: "tool",
      callId: "c1",
      tool: "look",
      summary: "page 1",
      input: {},
      state: "done",
      output: "ok",
      ms: 40,
    },
    {
      seq: 5,
      at: 5,
      type: "cost",
      model: "m",
      costUsd: 0.01,
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 0,
      ms: 5,
    },
    { seq: 6, at: 6, type: "end", status: "completed", verdict: "genuine" },
  ] as StoredEvent[];

  it("folds events the same in one batch or many, and drops repeats", () => {
    const once = applyEvents(emptyView(), events);
    let step = emptyView();
    for (const event of events) step = applyEvents(step, [event, event]);
    expect(step.feed).toEqual(once.feed);
    expect(once.feed.map((item) => item.kind)).toEqual(["thought", "tool"]);
    expect(once.tools.c1.state).toBe("done");
    expect(once.costUsd).toBeCloseTo(0.01);
    expect(once.status).toBe("completed");
    expect(once.look).toBeNull();
    expect(applyEvents(once, events)).toBe(once);
  });

  it("serves a Sample's file as it is and an Owner's through the gated route", () => {
    expect(assetUrl("x", "/loupe/samples/a/p1.jpg")).toBe(
      "/loupe/samples/a/p1.jpg",
    );
    expect(assetUrl("abc", "layers/sweep-ela.png")).toBe(
      "/api/loupe/examinations/abc/asset?key=layers%2Fsweep-ela.png",
    );
  });
});
