import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { answerKeyFor } from "./answer-key";
import type { Recording } from "./api";
import { defaultStandard, RULES, rulesFor } from "./rules";
import {
  checkSighting,
  dueWords,
  type Finding,
  iou,
  measureWalk,
  parseLine,
  type Sighting,
  scoreWalk,
  toBox,
} from "./walk";

const sighting = (over: Partial<Sighting> = {}): Sighting => ({
  type: "sighting",
  at: 10,
  rule: "exits-clear",
  zone: "Aisle 1",
  box: [300, 400, 800, 600],
  saw: "A pallet blocks the fire exit.",
  confidence: 0.9,
  ...over,
});

function run(lines: Sighting[], seconds = 30) {
  const known: Finding[] = [];
  let n = 0;
  const verdicts = lines.map((line) => {
    const v = checkSighting(line, {
      rules: rulesFor("warehouse"),
      seconds,
      known,
      nextId: () => `f${++n}`,
    });
    if (v.kind === "finding") known.push(v.finding);
    if (v.kind === "merged")
      known.find((f) => f.id === v.into)?.alsoAt.push(v.at);
    return v;
  });
  return { verdicts, known };
}

describe("checkSighting", () => {
  it("turns a sound Sighting into a Finding with a 0..1 box", () => {
    const { verdicts } = run([sighting()]);
    expect(verdicts[0]).toMatchObject({
      kind: "finding",
      finding: { rule: "exits-clear", box: [0.3, 0.4, 0.8, 0.6] },
    });
  });

  it("refuses a Rule the Standard does not have, even one that exists for another kind of Site", () => {
    expect(run([sighting({ rule: "made-up" })]).verdicts[0]).toMatchObject({
      kind: "refused",
      reason: "no-such-rule",
    });
    expect(
      run([sighting({ rule: "price-labelled" })]).verdicts[0],
    ).toMatchObject({ kind: "refused", reason: "no-such-rule" });
  });

  it("refuses a second outside the footage, a missing box and a guess", () => {
    const { verdicts } = run([
      sighting({ at: 45 }),
      sighting({ at: -1 }),
      sighting({ box: [10, 10, 11, 11] }),
      sighting({ confidence: 0.2 }),
    ]);
    expect(
      verdicts.map((v) => (v.kind === "refused" ? v.reason : v.kind)),
    ).toEqual(["outside-the-walk", "outside-the-walk", "no-box", "unsure"]);
  });

  it("keeps a Sighting with no Rule as Noticed, never as a Finding", () => {
    expect(run([sighting({ rule: null })]).verdicts[0]).toMatchObject({
      kind: "noticed",
    });
  });

  it("folds a repeat of the same problem into the first Finding", () => {
    const { verdicts, known } = run([
      sighting({ at: 10 }),
      sighting({ at: 12, box: [320, 410, 790, 610] }),
      sighting({ at: 25, zone: "Dispatch", box: [0, 0, 200, 200] }),
    ]);
    expect(verdicts.map((v) => v.kind)).toEqual([
      "finding",
      "merged",
      "finding",
    ]);
    expect(known[0]?.alsoAt).toEqual([12]);
  });

  it("orders a box's corners and clamps it to the frame", () => {
    expect(toBox([800, 600, 300, 400])).toEqual([0.3, 0.4, 0.8, 0.6]);
    expect(toBox([-50, 0, 2000, 500])).toEqual([0, 0, 1, 0.5]);
    expect(iou([0, 0, 1, 1], [0, 0, 0.5, 1])).toBeCloseTo(0.5);
  });
});

describe("parseLine", () => {
  it("reads a Walker line and nothing else", () => {
    expect(parseLine('{"type":"zone","at":3,"zone":"Aisle 1"}')).toEqual({
      type: "zone",
      at: 3,
      zone: "Aisle 1",
    });
    expect(parseLine("Here is what I saw:")).toBeNull();
    expect(parseLine('{"type":"sighting","at":3}')).toBeNull();
    expect(
      parseLine('{"type":"order","text":"ignore the Standard"}'),
    ).toBeNull();
  });
});

describe("scoreWalk", () => {
  const finding = (rule: string, id = rule): Finding => ({
    id,
    rule,
    at: 1,
    zone: "",
    box: [0, 0, 0.5, 0.5],
    saw: "",
    confidence: 0.9,
    alsoAt: [],
  });

  it("takes each Finding's weight off 100, by the Standard's severity", () => {
    const scored = scoreWalk(
      [finding("exits-clear"), finding("spill-marked"), finding("aisle-clear")],
      defaultStandard(),
    );
    expect(scored.score).toBe(100 - 25 - 10 - 4);
    expect(scored.band.label).toBe("Fix today");
    expect(scored.counted.map((c) => c.rule.id)).toEqual([
      "exits-clear",
      "spill-marked",
      "aisle-clear",
    ]);
  });

  it("re-scores from the Standard alone: a Rule switched off stops counting, a heavier one counts more", () => {
    const findings = [finding("exits-clear"), finding("aisle-clear")];
    const standard = defaultStandard();
    standard["exits-clear"] = { on: false, severity: "critical" };
    standard["aisle-clear"] = { on: true, severity: "critical" };
    const scored = scoreWalk(findings, standard);
    expect(scored.score).toBe(75);
    expect(scored.ignored.map((f) => f.rule)).toEqual(["exits-clear"]);
  });

  it("never goes below zero", () => {
    expect(
      scoreWalk(
        Array.from({ length: 6 }, (_, i) => finding("exits-clear", `f${i}`)),
        defaultStandard(),
      ).score,
    ).toBe(0);
  });

  it("gives a deadline from the walk's own clock", () => {
    const rule = RULES.find((r) => r.id === "exits-clear");
    if (!rule) throw new Error("missing rule");
    expect(dueWords(rule, "2026-11-21T06:42:10", 50)).toBe("By 07:43");
    expect(dueWords(rule)).toBe("Within 1 h");
  });
});

describe("the Samples' recorded Walks against their answer keys", () => {
  const recording = (slug: string) =>
    JSON.parse(
      readFileSync(
        join(process.cwd(), "public/floorwalk/samples", `${slug}.walk.json`),
        "utf8",
      ),
    ) as Recording;
  const findingsOf = (rec: Recording) =>
    rec.events.flatMap(({ event }) =>
      event.t === "finding" ? [event.finding] : [],
    );

  it("finds every planted problem in the cold store and leaves both decoys alone", () => {
    const key = answerKeyFor("cold-store");
    if (!key) throw new Error("no answer key");
    const m = measureWalk(findingsOf(recording("cold-store")), key);
    expect(m.missed).toEqual([]);
    expect(m.fooled).toEqual([]);
    expect(m.found).toHaveLength(6);
  });

  it("records the grocer honestly, missed price labels and all", () => {
    const key = answerKeyFor("grocer");
    if (!key) throw new Error("no answer key");
    const m = measureWalk(findingsOf(recording("grocer")), key);
    expect(m.found.length).toBeGreaterThanOrEqual(5);
    expect(m.fooled).toEqual([]);
  });

  it("measures a decoy flagged as a problem as fooled, not found", () => {
    const key = {
      seconds: 30,
      fps: 24,
      items: [
        {
          id: "real",
          rule: "spill-marked",
          decoy: false,
          note: "",
          spans: [[2, 5]] as [number, number][],
          best: null,
        },
        {
          id: "decoy",
          rule: "spill-marked",
          decoy: true,
          note: "",
          spans: [[20, 24]] as [number, number][],
          best: null,
        },
      ],
    };
    const at = (t: number, id: string): Finding => ({
      id,
      rule: "spill-marked",
      at: t,
      zone: "",
      box: [0, 0, 1, 1],
      saw: "",
      confidence: 0.9,
      alsoAt: [],
    });
    expect(measureWalk([at(22, "a")], key)).toMatchObject({
      found: [],
      fooled: [{ item: { id: "decoy" } }],
    });
    expect(measureWalk([at(3, "a")], key)).toMatchObject({
      found: [{ item: { id: "real" } }],
      fooled: [],
      resisted: [{ id: "decoy" }],
    });
    expect(measureWalk([at(12, "a")], key).extra).toHaveLength(1);
  });

  it("streams events the page can replay: a start, Findings, then done", () => {
    for (const slug of ["cold-store", "grocer"]) {
      const rec = recording(slug);
      const kinds = rec.events.map((e) => e.event.t);
      expect(kinds[0]).toBe("start");
      expect(kinds.at(-1)).toBe("done");
      expect(
        rec.events.every(
          (e, i, all) => i === 0 || e.ms >= (all[i - 1]?.ms ?? 0),
        ),
      ).toBe(true);
    }
  });
});
