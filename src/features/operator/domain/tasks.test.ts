import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseBooks } from "../legacy/base-books";
import { diffBooks, linesOf } from "../legacy/books";
import { Session } from "../legacy/test-kit";
import type { Change } from "../legacy/types";
import { ACTION_LIMITS, screenActionSchema } from "./actions";
import { isValidContainer } from "./iso6346";
import { parseManifest } from "./manifest";
import type { Expectation } from "./task";
import { SAMPLE_TASKS, sampleTask } from "./tasks";

/**
 * Local to this test (the real check lives elsewhere): a Change satisfies an
 * Expectation when op and record agree, `where` picks its record, `values`
 * hold afterwards, and an update touches no field outside `values`.
 */
function satisfies(change: Change, want: Expectation): boolean {
  if (change.op !== want.op || change.record !== want.record) return false;
  const picked = change.op === "delete" ? change.before : change.after;
  const holds = (fields: Expectation["where"] | undefined) =>
    Object.entries(fields ?? {}).every(([k, v]) => picked?.[k] === v);
  if (!holds(want.where)) return false;
  if (change.op === "delete") return true;
  if (!holds(want.values)) return false;
  if (change.op !== "update") return true;
  const allowed = Object.keys(want.values ?? {});
  return (change.fields ?? []).every((f) => allowed.includes(f));
}

function play(taskId: string): Session {
  const task = sampleTask(taskId);
  if (!task) throw new Error(`no sample Task ${taskId}`);
  const session = new Session(task.fixture);
  for (const turn of task.script) session.act(...turn.actions);
  return session;
}

describe("SAMPLE_TASKS", () => {
  it("are the three, in order", () => {
    expect(SAMPLE_TASKS.map((t) => t.id)).toEqual([
      "arrival-corvina",
      "release-and-berth",
      "manifest-correction",
    ]);
    expect(SAMPLE_TASKS.map((t) => t.needsApproval)).toEqual([
      false,
      true,
      true,
    ]);
    expect(sampleTask("nope")).toBeUndefined();
  });

  for (const task of SAMPLE_TASKS) {
    describe(task.id, () => {
      const lockRetries = task.fixture.locks.reduce((n, l) => n + l.retries, 0);

      it("has a Script that makes exactly the expected changes and signs off", () => {
        const session = play(task.id);
        const changes = diffBooks(task.fixture.books, session.state.books);
        for (const want of task.expected) {
          const matches = changes.filter((c) => satisfies(c, want));
          expect(matches, want.label).toHaveLength(1);
        }
        for (const change of changes) {
          const wanted = task.expected.filter((w) => satisfies(change, w));
          expect(
            wanted,
            `${change.op} ${change.record} ${change.key}`,
          ).toHaveLength(1);
        }
        expect(changes).toHaveLength(task.expected.length);
        expect(session.state.signedOn).toBe(false);
        expect(session.state.screen).toBe("HMS000");
        expect(session.state.errors).toBe(lockRetries);
      });

      it("has a Script of valid Actions with plain intents", () => {
        expect(task.script.length).toBeGreaterThanOrEqual(12);
        expect(task.script.length).toBeLessThanOrEqual(25);
        for (const turn of task.script) {
          expect(turn.intent.length).toBeGreaterThan(3);
          expect(turn.intent).not.toMatch(/\n|HM[A-Z]\d{3}/);
          expect(turn.actions.length).toBeGreaterThan(0);
          for (const action of turn.actions) {
            expect(screenActionSchema.safeParse(action).success).toBe(true);
            if (action.type === "type") {
              expect(action.text.length).toBeLessThanOrEqual(
                ACTION_LIMITS.typeChars,
              );
            }
          }
        }
      });

      it("has a brief that gives the sign on and names no key or Screen", () => {
        expect(task.brief).toContain(task.fixture.operator.id);
        expect(task.brief).toContain(task.fixture.operator.password);
        expect(task.brief).not.toMatch(
          /\bF\d{1,2}\b|\bEnter\b|\bTab\b|HM[A-Z]\d{3}/,
        );
        expect(task.fixture.id).toBe(task.id);
        expect(task.fixture.idleSeconds).toBe(240);
        expect(task.fixture.portTime.startsWith("2026-11-")).toBe(true);
        expect(task.fixture.operator).toEqual({
          id: "OPR7",
          password: "MERIDIA1",
        });
        expect(task.traps.length).toBeGreaterThan(0);
      });

      it("starts from the base Books", () => {
        expect(task.fixture.books).toEqual(baseBooks());
      });
    });
  }

  it("locks the berth record of Task 2 for two retries", () => {
    expect(sampleTask("release-and-berth")?.fixture.locks).toEqual([
      { record: "berth", key: "0398S", clerk: "CLERK07", retries: 2 },
    ]);
  });

  it("leaves the protected consignee of line 9 alone in Task 3", () => {
    const session = play("manifest-correction");
    const [update] = diffBooks(baseBooks(), session.state.books);
    expect(update.fields).toEqual(["grossKg"]);
    expect(update.before?.consignee).toBe(update.after?.consignee);
  });
});

describe("containers", () => {
  it("in the base Books all carry a valid check digit", () => {
    const books = baseBooks();
    expect(books.vessels).toHaveLength(10);
    expect(books.lines.length).toBeGreaterThanOrEqual(45);
    expect(linesOf(books, "0377E").length).toBeGreaterThanOrEqual(14);
    for (const line of books.lines) {
      expect(isValidContainer(line.container), line.container).toBe(true);
      expect(line.goods.length).toBeLessThanOrEqual(24);
    }
    for (const hold of books.holds) {
      expect(isValidContainer(hold.container), hold.container).toBe(true);
      expect(books.lines.some((l) => l.container === hold.container)).toBe(
        true,
      );
    }
    expect(new Set(books.holds.map((h) => h.status))).toEqual(
      new Set(["ACTIVE", "RELEASED"]),
    );
    expect(new Set(books.vessels.map((v) => v.imo)).size).toBe(10);
    expect(new Set(books.vessels.map((v) => v.voyage)).size).toBe(10);
  });

  it("in the expectations all carry a valid check digit", () => {
    for (const task of SAMPLE_TASKS) {
      for (const want of task.expected) {
        const container = want.where.container;
        if (typeof container === "string") {
          expect(isValidContainer(container), container).toBe(true);
        }
      }
    }
  });
});

describe("sample manifests", () => {
  const withManifest = SAMPLE_TASKS.filter((t) => t.manifest);

  it("are the files under public/operator/samples, byte for byte", () => {
    expect(withManifest.map((t) => t.id)).toEqual(["arrival-corvina"]);
    for (const task of withManifest) {
      const manifest = task.manifest;
      if (!manifest) continue;
      expect(manifest.href).toBe(`/operator/samples/${manifest.name}`);
      const file = readFileSync(
        join(process.cwd(), "public", manifest.href),
        "utf8",
      );
      expect(file).toBe(manifest.text);
      expect(file.split("\n")[0]).toBe(
        "# SPECIMEN - Port Authority of Meridia - cargo manifest",
      );
    }
  });

  it("parse cleanly into the lines the Task expects", () => {
    const task = sampleTask("arrival-corvina");
    const parsed = parseManifest(task?.manifest?.text ?? "");
    expect(parsed.problems).toEqual([]);
    expect(parsed.vessel).toBe("MV CORVINA");
    expect(parsed.voyage).toBe("0412N");
    expect(parsed.lines).toHaveLength(6);
    const wanted = task?.expected.filter((e) => e.record === "line") ?? [];
    expect(wanted).toHaveLength(6);
    for (const row of parsed.lines) {
      expect(isValidContainer(row.container), row.container).toBe(true);
      expect(row.grossKg).toBeLessThanOrEqual(99999);
      const want = wanted.find((w) => w.where.container === row.container);
      expect(want?.values).toMatchObject({
        isoType: row.isoType,
        seal: row.seal,
        grossKg: row.grossKg,
        pol: row.pol,
        consignee: row.consignee,
        haz: row.haz,
      });
    }
    // The traps the file carries.
    expect(task?.manifest?.text).toContain("MRDU 482113 1");
    expect(parsed.lines.some((l) => l.goods.length > 24)).toBe(true);
    expect(task?.brief).toContain("MRDU 482113 1");
  });
});
