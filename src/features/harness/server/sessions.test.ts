import { beforeEach, describe, expect, it, vi } from "vitest";

const SID = "123e4567-e89b-42d3-a456-426614174000";

const state = vi.hoisted(() => ({
  audits: [] as { action: string; usage?: unknown }[],
  inserts: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("./rate", () => ({ takeRate: async () => {} }));
vi.mock("./audit", () => ({
  auditIn: async (_tx: unknown, input: { action: string; usage?: unknown }) => {
    state.audits.push(input);
    return 1;
  },
}));
vi.mock("./db", () => {
  const session = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    title: "A session",
    status: "open",
    staff_id: "s1",
    staff_name: "Keisha",
    staff_initials: "KW",
    preview: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  // A tagged template that answers by the statement it is given.
  const db = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("insert into harness.messages")) {
      state.inserts.push(values);
      return [{ id: "m1", created_at: new Date() }];
    }
    if (text.includes("from harness.sessions")) return [session];
    return [];
  };
  return {
    isUuid: (value: unknown) => typeof value === "string",
    jsonb: (_db: unknown, value: unknown) => value,
    sql: () =>
      Object.assign(db, { begin: (fn: (tx: unknown) => unknown) => fn(db) }),
  };
});

import { appendMessage } from "./sessions";

describe("appendMessage", () => {
  beforeEach(() => {
    state.audits.length = 0;
    state.inserts.length = 0;
  });

  it("keeps an Agent turn's cost on the message row and off its message.sent event", async () => {
    const usage = {
      model: "anthropic/claude-sonnet-5.5",
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.0054,
    };
    const { message } = await appendMessage({
      role: "agent",
      owner: "e2e",
      sessionId: SID,
      content: "Done.",
      usage,
    });
    expect(message.usage).toEqual(usage);
    // model, input_tokens, output_tokens, cost_usd are the row's last four values.
    expect(state.inserts[0]?.slice(-4)).toEqual([
      usage.model,
      1200,
      300,
      0.0054,
    ]);
    const sent = state.audits.filter(
      (event) => event.action === "message.sent",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.usage).toBeNull();
  });
});
