/**
 * Scoring against ground truth: an Examination against a Sample's Manifest
 * entry or a Forgery's Edits (`scoreExamination`), and the Sweep under a
 * Rulebook against the whole Corpus (`calibrate`). Pure.
 */
import {
  type DocumentKind,
  type Edit,
  type Finder,
  type Finding,
  type ManifestEntry,
  type Measurement,
  type RawMeasurement,
  type Score,
  type Split,
  SPLITS,
  type Tamper,
  type TamperType,
  type Verdict,
} from "./contract";
import { decide, evaluate, touches } from "./evaluate";
import type { Rulebook } from "./rules";

const AMOUNT = /^[^\d-]*-?\d[\d,.\s]*$/;

/** Whether a Tamper changed a figure (so an arithmetic Finding on its page answers to it). */
function changedAnAmount(tamper: Tamper) {
  return Boolean(tamper.to && AMOUNT.test(tamper.to.trim()));
}

/**
 * Whether a Finding answers to a Tamper. A Finding with a box must touch the
 * Tamper's box on the same page. An arithmetic Finding sits on the total
 * that no longer adds up, which may be lines away from the edited figure, so
 * it answers to any changed amount on its page. A Finding about the whole
 * file (no box) names no place and answers to no Tamper in particular.
 */
export function answersTo(finding: Finding, tamper: Tamper) {
  if (finding.weight === "context") return false;
  if (finding.page !== tamper.page) return false;
  if (finding.metric.startsWith("arith.") && changedAnAmount(tamper))
    return true;
  return finding.box !== null && touches(finding.box, tamper.box);
}

/** An Edit from the Forge bench as a Tamper. */
export function tampersOfEdits(edits: Edit[]): Tamper[] {
  return edits.map((edit) => ({
    type: "browser_edit" as const,
    page: edit.page,
    box: edit.box,
    field: edit.kind,
    ...(edit.to ? { to: edit.to } : {}),
  }));
}

/** How an Examination's Findings and Verdict did against the Tampers that were really made. */
export function scoreExamination(input: {
  tampers: Tamper[];
  findings: Finding[];
  verdict: Verdict;
}): Score {
  const counted = input.findings.filter(
    (finding) => finding.weight !== "context",
  );
  const perTamper = input.tampers.map((tamper) => {
    const hit = counted.find((finding) => answersTo(finding, tamper));
    return {
      type: tamper.type,
      page: tamper.page,
      box: tamper.box,
      ...(tamper.field ? { field: tamper.field } : {}),
      caught: Boolean(hit),
      findingId: hit?.id ?? null,
    };
  });
  const truth = input.tampers.length > 0 ? "tampered" : "genuine";
  // On a tampered Document a Finding about the whole file (a later save, an
  // editor's name) is true of it; only a Finding that points at an untouched
  // place is false. On a genuine one every counted Finding is false.
  const falseFindings = counted.filter((finding) =>
    truth === "genuine"
      ? true
      : finding.box !== null &&
        !input.tampers.some((tamper) => answersTo(finding, tamper)),
  ).length;
  return {
    truth,
    verdict: input.verdict,
    correct:
      truth === "genuine"
        ? input.verdict === "genuine"
        : input.verdict !== "genuine",
    tampers: input.tampers.length,
    caught: perTamper.filter((item) => item.caught).length,
    falseFindings,
    perTamper,
  };
}

// Calibration ---------------------------------------------------------------------

/** A recorded Sweep of one Corpus Document (fixtures/loupe/expected/<id>.json). */
export type RecordedSweep = {
  id: string;
  measurements: RawMeasurement[];
};

/** Recorded Sweep Measurements as Measurements of an Examination. */
export function asMeasurements(
  raw: RawMeasurement[],
  finder: Finder,
  runId: string,
  prefix: string,
  layerKey: (file: string) => string = (file) => file,
  startAt = 1,
): Measurement[] {
  return raw.map((item, index) => ({
    id: `${prefix}${startAt + index}`,
    metric: item.metric,
    value: item.value,
    page: item.page,
    box: item.box ?? null,
    detail: item.detail,
    facts: item.facts ?? {},
    layer: item.layer ? layerKey(item.layer) : null,
    layerKind: item.layer ? (item.layerKind ?? "heatmap") : null,
    finder,
    check: item.check ?? null,
    runId,
  }));
}

export type SplitCalibration = {
  split: Split;
  documents: number;
  genuine: number;
  tampered: number;
  /** Tampered Documents the Sweep is not expected to catch (`hard`). */
  hard: number;
  /** Tampered Documents called Suspicious or Tampered. */
  detected: number;
  /** Of those, the ones called Tampered. */
  calledTampered: number;
  /** Genuine and benign Documents called Suspicious or Tampered. */
  falsePositives: number;
  /** detected / tampered. */
  detectionRate: number;
  /** falsePositives / genuine. */
  falsePositiveRate: number;
  tampers: number;
  /** Tampers with a Finding on them. */
  tampersCaught: number;
};

export type Calibration = {
  splits: SplitCalibration[];
  byTamper: { type: TamperType; tampers: number; caught: number }[];
  /** Tampered Documents the Sweep called Genuine. */
  missed: { id: string; split: Split; hard: boolean; types: TamperType[] }[];
  /** Genuine Documents the Sweep flagged. */
  falselyFlagged: { id: string; split: Split; verdict: Verdict }[];
};

const rate = (part: number, whole: number) =>
  whole === 0 ? 0 : Number((part / whole).toFixed(4));

/** The Sweep alone, under a Rulebook, against the Corpus. No model takes part. */
export function calibrate(
  manifest: ManifestEntry[],
  recorded: Map<string, RecordedSweep>,
  rulebook: Rulebook,
): Calibration {
  const perSplit = new Map<Split, SplitCalibration>(
    SPLITS.map((split) => [
      split,
      {
        split,
        documents: 0,
        genuine: 0,
        tampered: 0,
        hard: 0,
        detected: 0,
        calledTampered: 0,
        falsePositives: 0,
        detectionRate: 0,
        falsePositiveRate: 0,
        tampers: 0,
        tampersCaught: 0,
      },
    ]),
  );
  const byTamper = new Map<TamperType, { tampers: number; caught: number }>();
  const missed: Calibration["missed"] = [];
  const falselyFlagged: Calibration["falselyFlagged"] = [];

  for (const entry of manifest) {
    const sweep = recorded.get(entry.id);
    if (!sweep) continue;
    const row = perSplit.get(entry.split);
    if (!row) continue;
    const result = sweepVerdict(sweep.measurements, entry.kind, rulebook);
    const score = scoreExamination({
      tampers: entry.tampers,
      findings: result.findings,
      verdict: result.verdict.verdict,
    });
    row.documents += 1;
    if (entry.tampers.length === 0) {
      row.genuine += 1;
      if (!score.correct) {
        row.falsePositives += 1;
        falselyFlagged.push({
          id: entry.id,
          split: entry.split,
          verdict: result.verdict.verdict,
        });
      }
    } else {
      row.tampered += 1;
      if (entry.hard) row.hard += 1;
      if (score.correct) row.detected += 1;
      else
        missed.push({
          id: entry.id,
          split: entry.split,
          hard: entry.hard,
          types: entry.tampers.map((tamper) => tamper.type),
        });
      if (result.verdict.verdict === "tampered") row.calledTampered += 1;
      row.tampers += score.tampers;
      row.tampersCaught += score.caught;
      for (const item of score.perTamper) {
        const tally = byTamper.get(item.type) ?? { tampers: 0, caught: 0 };
        tally.tampers += 1;
        if (item.caught) tally.caught += 1;
        byTamper.set(item.type, tally);
      }
    }
  }
  const splits = [...perSplit.values()].map((row) => ({
    ...row,
    detectionRate: rate(row.detected, row.tampered),
    falsePositiveRate: rate(row.falsePositives, row.genuine),
  }));
  return {
    splits,
    byTamper: [...byTamper.entries()]
      .map(([type, tally]) => ({ type, ...tally }))
      .sort((a, b) => a.type.localeCompare(b.type)),
    missed,
    falselyFlagged,
  };
}

/** The Findings and Verdict the Sweep alone gives a Document under a Rulebook. */
export function sweepVerdict(
  raw: RawMeasurement[],
  kind: DocumentKind,
  rulebook: Rulebook,
) {
  const findings = evaluate({
    measurements: asMeasurements(raw, "sweep", "sweep", "s"),
    kind,
    rulebook,
  });
  return { findings, verdict: decide(findings, rulebook) };
}

/** All splits as one row, for the page's one-line claim. */
export function overall(calibration: Calibration) {
  const sum = (pick: (row: SplitCalibration) => number) =>
    calibration.splits.reduce((total, row) => total + pick(row), 0);
  const genuine = sum((row) => row.genuine);
  const tampered = sum((row) => row.tampered);
  const detected = sum((row) => row.detected);
  const falsePositives = sum((row) => row.falsePositives);
  return {
    documents: sum((row) => row.documents),
    genuine,
    tampered,
    detected,
    falsePositives,
    detectionRate: rate(detected, tampered),
    falsePositiveRate: rate(falsePositives, genuine),
  };
}
