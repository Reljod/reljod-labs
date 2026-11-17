import { describe, expect, it, vi } from "vitest";

/* The classify Step of a member request, with the database and the model faked. */

const model = vi.hoisted(() => ({ calls: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("../db", () => ({ sql: () => ({}), jsonb: () => ({}) }));
vi.mock("../records", () => ({
  findMembers: async () => [],
  memberByIdOrNo: async () => null,
}));
vi.mock("./source-file", () => ({
  sourcesOf: async () => [],
  sourceText: async () => "",
}));
vi.mock("./model", () => ({
  classifyRequest: async () => {
    model.calls += 1;
    return { value: { kind: null, confidence: 0, reason: "" }, usage: null };
  },
  readPapers: async () => ({}),
  writeDraftBody: async () => ({}),
}));

import type { StartedVia } from "../../domain/run";
import { MEMBER_REQUEST_RUNNER } from "./member-request";
import type { RunContext } from "./types";

const RETIREMENT_FORM =
  "MEMBER REQUEST FORM\nRequest type: Retirement\nMember name: A. Person";

function ctxOf(startedVia: StartedVia | undefined, kind: string): RunContext {
  return {
    runId: "run-1",
    owner: "e2e",
    sessionId: null,
    pipelineId: "member_request",
    input: { sourceIds: ["s-1"], kind },
    asOf: "2026-11-17",
    stubbed: true,
    states: {},
    startedBy: { id: "s", name: "S" },
    ...(startedVia ? { startedVia } : {}),
  } as RunContext;
}

const deps = {
  intake: {
    sources: [
      {
        id: "s-1",
        title: "Request",
        kind: "text",
        addedOn: "2026-11-17",
        text: RETIREMENT_FORM,
        chars: RETIREMENT_FORM.length,
      },
    ],
    receivedOn: "2026-11-17",
    note: null,
  },
};

async function classify(via: StartedVia | undefined, kind: string) {
  const result = await MEMBER_REQUEST_RUNNER.steps.classify?.(
    ctxOf(via, kind),
    deps,
  );
  if (!result) throw new Error("no classify Step");
  return result as typeof result & {
    output: { kindReading: { givenBy: string; keywords: string | null } };
  };
}

describe("classify: who stated a kind given in the input", () => {
  it.each([
    ["app", "staff"],
    ["demo", "guide"],
    ["chat", "agent"],
    ["mcp", "agent"],
    [undefined, "agent"],
  ] as const)("a Run started via %s records the kind as given by %s", async (via, by) => {
    const result = await classify(via, "death");
    expect(result.output.kindReading.givenBy).toBe(by);
    expect(result.output.kindReading.keywords).toBe("retirement");
  });

  it("says a person must confirm when the Agent's kind is not the papers' wording", async () => {
    const result = await classify("chat", "death");
    expect(result.summary).toMatch(
      /Stated by the Agent, not confirmed by the papers' own wording/,
    );
  });

  it("says the Agent's kind matches when the papers' wording agrees", async () => {
    const result = await classify("mcp", "retirement");
    expect(result.summary).toMatch(/Stated by the Agent; matches/);
  });

  it("never calls the model for a given kind", async () => {
    model.calls = 0;
    await classify("chat", "retirement");
    await classify("app", "retirement");
    expect(model.calls).toBe(0);
  });
});
