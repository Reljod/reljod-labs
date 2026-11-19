import { describe, expect, it } from "vitest";
import { METRIC_IDS } from "./contract";
import { MANIFEST, RECORDED, sampleCards } from "./corpus";
import { DEFAULT_RULEBOOK, withRule } from "./rules";
import { calibrate, overall, sweepVerdict } from "./score";

/**
 * The model-free Sweep under the Default Rulebook, scored against the
 * Manifest. Thresholds were tuned on train and validation only
 * (fixtures/loupe/tuning.json); the test split is asserted here as a floor
 * that was measured, never tuned toward.
 */
const calibration = calibrate(MANIFEST, RECORDED, DEFAULT_RULEBOOK);
const split = (name: string) => {
  const row = calibration.splits.find((item) => item.split === name);
  if (!row) throw new Error(`no split ${name}`);
  return row;
};

describe("the Corpus", () => {
  it("has a recorded Sweep for every Document, in three splits", () => {
    expect(MANIFEST.length).toBeGreaterThanOrEqual(40);
    for (const entry of MANIFEST) expect(RECORDED.has(entry.id)).toBe(true);
    for (const name of ["train", "validation", "test"]) {
      expect(split(name).genuine).toBeGreaterThan(0);
      expect(split(name).tampered).toBeGreaterThan(0);
    }
  });

  it("keeps a variant in its original's split", () => {
    for (const entry of MANIFEST) {
      const base = MANIFEST.find((item) => item.id === entry.baseId);
      expect(base?.split).toBe(entry.split);
    }
  });

  it("only measures under known Metrics", () => {
    for (const sweep of RECORDED.values())
      for (const item of sweep.measurements)
        expect(METRIC_IDS).toContain(item.metric);
  });

  it("shows Samples that never say whether they were tampered with", () => {
    const cards = sampleCards();
    expect(cards.length).toBeGreaterThanOrEqual(8);
    for (const card of cards) {
      expect(card.pages.length).toBeGreaterThan(0);
      expect(`${card.title} ${card.blurb}`).not.toMatch(
        /\b(tamper|forg|edited|fake|genuine|benign)/i,
      );
    }
  });
});

describe("the Sweep under the Default Rulebook", () => {
  it("flags no genuine or benign Document in any split", () => {
    expect(calibration.falselyFlagged).toEqual([]);
    for (const row of calibration.splits) expect(row.falsePositiveRate).toBe(0);
  });

  it("detects the tampered Documents it was tuned on", () => {
    // Train: every Document that is not marked hard.
    const train = split("train");
    expect(train.detected).toBe(train.tampered - train.hard);
    expect(split("validation").detectionRate).toBeGreaterThanOrEqual(0.6);
  });

  it("holds on the test split, which was never tuned on", () => {
    expect(split("test").detectionRate).toBeGreaterThanOrEqual(0.75);
  });

  it("misses what it is expected to miss, and says so", () => {
    const hardMissed = calibration.missed.filter((item) => item.hard);
    const hard = MANIFEST.filter((entry) => entry.hard);
    // A hard Tamper keeps every number consistent: the Sweep has nothing to measure.
    expect(hardMissed.length).toBe(hard.length);
  });

  it("reports one overall line the page can quote", () => {
    const all = overall(calibration);
    expect(all.documents).toBe(MANIFEST.length);
    expect(all.falsePositiveRate).toBe(0);
    expect(all.detectionRate).toBeGreaterThan(0.7);
    expect(all.detectionRate).toBeLessThan(1);
  });
});

describe("a Rule edit changes the Calibration", () => {
  it("flags genuine Documents when a pixel threshold is set too low", () => {
    const loose = withRule(DEFAULT_RULEBOOK, "image.noise_ratio", {
      threshold: 1.2,
    });
    const result = calibrate(MANIFEST, RECORDED, loose);
    expect(result.falselyFlagged.length).toBeGreaterThan(0);
  });

  it("stops detecting a Tamper when its Rule is turned off", () => {
    const entry = MANIFEST.find(
      (item) =>
        item.tampers.some((tamper) => tamper.type === "incremental_update") &&
        sweepVerdict(
          RECORDED.get(item.id)?.measurements ?? [],
          item.kind,
          DEFAULT_RULEBOOK,
        ).findings.some((f) => f.metric === "pdf.incremental_updates"),
    );
    expect(entry).toBeDefined();
    if (!entry) return;
    const raw = RECORDED.get(entry.id)?.measurements ?? [];
    const before = sweepVerdict(raw, entry.kind, DEFAULT_RULEBOOK);
    expect(before.verdict.verdict).toBe("tampered");
    const off = withRule(DEFAULT_RULEBOOK, "pdf.incremental_updates", {
      enabled: false,
    });
    const after = sweepVerdict(raw, entry.kind, off);
    expect(
      after.findings.some((f) => f.metric === "pdf.incremental_updates"),
    ).toBe(false);
  });
});
