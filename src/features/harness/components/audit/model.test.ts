import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, type AuditEvent } from "../../domain/audit";
import {
  ACTION_GROUPS,
  auditCsv,
  auditTotals,
  csvCell,
  detailRows,
  eventLinks,
  SESSION_HUES,
  sessionChoices,
  sessionHue,
  shortId,
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

describe("Sandbox events", () => {
  const command = event({
    id: 4,
    action: "sandbox.command",
    detail: { command: "python3 a.py", timeoutMs: 30000 },
  });
  const finished = event({
    id: 5,
    action: "sandbox.command_finished",
    detail: { exitCode: 0, durationMs: 420, timedOut: false },
  });

  it("does not count a command twice as Agent calls", () => {
    expect(auditTotals([command, finished]).agentCalls).toBe(0);
    expect(auditTotals([command, finished]).events).toBe(2);
  });

  it("has a label for all three Sandbox command events", () => {
    for (const action of [
      "sandbox.command",
      "sandbox.command_finished",
      "sandbox.file_written",
    ] as const) {
      expect(AUDIT_ACTIONS[action]).toBeTruthy();
    }
  });

  it("reads durations, sizes and flags as a person would", () => {
    expect(detailRows(finished.detail, finished.action)).toEqual([
      { key: "Exit code", value: "0" },
      { key: "Duration", value: "420 ms" },
      { key: "Timed out", value: "no" },
    ]);
    expect(
      detailRows({ path: "a.txt", bytes: 2048 }, "sandbox.file_written"),
    ).toEqual([
      { key: "File", value: "a.txt" },
      { key: "Size", value: "2.0 KB" },
    ]);
    expect(detailRows(command.detail, command.action)[1]).toEqual({
      key: "Time limit",
      value: "30.0 s",
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

describe("Sessions in the trail", () => {
  const A = "dad3b65f-1aa7-4168-b61d-4e601ecf7d59";
  const B = "5210dbf3-0000-4000-8000-000000000000";

  it("gives a Session a short id and the same colour every time", () => {
    expect(shortId(A)).toBe("dad3b65f");
    expect(sessionHue(A)).toBe(sessionHue(A));
    expect(SESSION_HUES).toContain(sessionHue(B));
  });

  it("offers listed Sessions first, then ones only the trail has shown, by title and short id", () => {
    const choices = sessionChoices(
      [{ id: A, title: "Penhallow request" }],
      new Map([
        [A, "Penhallow request"],
        [B, null],
      ]),
    );
    expect(choices.map((choice) => choice.label)).toEqual([
      "Penhallow request (dad3b65f)",
      "Session (5210dbf3)",
    ]);
  });

  it("puts the Session id and title in the CSV", () => {
    const text = auditCsv([
      event({ sessionId: A, sessionTitle: "Penhallow request" }),
    ]);
    const [head, row] = text.trim().split("\r\n");
    expect(head).toContain("session_id,session_title");
    expect(row).toContain(`${A},Penhallow request`);
  });
});
