import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../../domain/audit";
import {
  ACTION_GROUPS,
  auditCsv,
  auditTotals,
  csvCell,
  detailRows,
  eventLinks,
} from "./model";

const event = (patch: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 1,
  sessionId: null,
  runId: null,
  actorKind: "staff",
  staffId: "s1",
  actorLabel: "Ada Officer",
  action: "rule.saved",
  targetKind: "rule",
  targetId: "mr.notice",
  summary: "Saved a Rule",
  detail: {},
  model: null,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  createdAt: "2026-11-17T10:00:00.000Z",
  ...patch,
});

describe("auditTotals", () => {
  it("counts events and sums only the Agent's model calls", () => {
    const totals = auditTotals([
      event(),
      event({
        id: 2,
        actorKind: "agent",
        action: "model.called",
        model: "m",
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.01,
      }),
      event({
        id: 3,
        actorKind: "agent",
        action: "model.called",
        model: "m",
        inputTokens: 50,
        outputTokens: 5,
        costUsd: null,
      }),
    ]);
    expect(totals).toEqual({
      events: 3,
      agentCalls: 2,
      inputTokens: 150,
      outputTokens: 25,
      costUsd: 0.01,
      costPartial: true,
    });
  });
});

describe("csv", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(0.5)).toBe("0.5");
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell(-2)).toBe("-2");
  });

  it("writes a header and one row per event, with the action label", () => {
    const text = auditCsv([
      event({ summary: "Saved, then more", detail: { version: 2 } }),
    ]);
    const [header, row] = text.trim().split("\r\n");
    expect(header?.startsWith("id,time,actor_kind")).toBe(true);
    expect(row).toContain("Rule saved");
    expect(row).toContain('"Saved, then more"');
    expect(row).toContain('"{""version"":2}"');
  });

  it("is only a header for no events", () => {
    expect(auditCsv([]).trim().split("\r\n")).toHaveLength(1);
  });
});

describe("detailRows", () => {
  it("flattens nested objects and joins lists, never a raw blob", () => {
    expect(
      detailRows({
        version: 3,
        params: { days: [30, 45], note: null },
        files: ["a", "b"],
        empty: {},
      }),
    ).toEqual([
      { key: "version", value: "3" },
      { key: "params.days", value: "30 → 45" },
      { key: "params.note", value: "none" },
      { key: "files", value: "a → b" },
      { key: "empty", value: "(empty)" },
    ]);
  });
});

describe("eventLinks", () => {
  it("links the Session, the Run and the target", () => {
    expect(
      eventLinks(event({ sessionId: "s", runId: "r" })).map((l) =>
        l.kind === "tab"
          ? `${l.tab}:${JSON.stringify(l.params)}`
          : `${l.kind}:${l.id}`,
      ),
    ).toEqual(["session:s", "run:r", 'skills:{"rule":"mr.notice"}']);
    expect(
      eventLinks(event({ targetKind: "conflict", targetId: "c" }))[0],
    ).toMatchObject({ tab: "knowledge", params: { conflict: "c" } });
    expect(eventLinks(event({ targetKind: "plugin", targetId: "x" }))).toEqual(
      [],
    );
  });
});

describe("ACTION_GROUPS", () => {
  it("covers every action once", () => {
    const all = ACTION_GROUPS.flatMap((g) => g.actions);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("rule.saved");
    expect(ACTION_GROUPS.find((g) => g.group === "Other")).toBeUndefined();
  });
});
