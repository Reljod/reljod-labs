/**
 * Rules are data, checks are code (ADR 0015, ADR 0027). Everything that
 * decides is here and pure: Measurements and a Rulebook in, Findings and a
 * Verdict out. No model takes part, so a finished Examination can be decided
 * again under an edited Rulebook from its stored Measurements alone.
 */
import {
  type Box,
  type DocumentKind,
  type DoneGate,
  type Finder,
  type Finding,
  type Hypothesis,
  METRICS,
  type Measurement,
  type MetricId,
  type Review,
  type VerdictResult,
  type Weight,
} from "./contract";
import { formatThreshold, RULE_TEXT, type Rulebook } from "./rules";

// Boxes ----------------------------------------------------------------------------

export function boxArea(box: Box) {
  return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
}

export function intersection(a: Box, b: Box) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Intersection over union, 0..1. */
export function iou(a: Box, b: Box) {
  const inter = intersection(a, b);
  if (inter === 0) return 0;
  return inter / (boxArea(a) + boxArea(b) - inter);
}

/** Whether two boxes share any area, or one's centre lies in the other. */
export function touches(a: Box, b: Box) {
  if (intersection(a, b) > 0) return true;
  const inside = (p: Box, q: Box) => {
    const cx = (p[0] + p[2]) / 2;
    const cy = (p[1] + p[3]) / 2;
    return cx >= q[0] && cx <= q[2] && cy >= q[1] && cy <= q[3];
  };
  return inside(a, b) || inside(b, a);
}

// Reading a Measurement under a Rulebook ---------------------------------------------

const PIXEL_METRICS = new Set<MetricId>([
  "image.ela_ratio",
  "image.noise_ratio",
  "image.jpeg_ghost",
  "image.edge_halo",
]);

function matchesAny(text: string, list: string[]) {
  const lower = text.toLowerCase();
  return list.some((item) => lower.includes(item.toLowerCase()));
}

/**
 * The value a Rule holds a Measurement to. Most are the measured number.
 * `pdf.editor_producer` is decided by the Rulebook's lists, not the
 * Toolkit's: the producer the file names is matched against the Owner's
 * editors, and a benign producer never counts.
 */
export function effectiveValue(measurement: Measurement, rulebook: Rulebook) {
  if (measurement.metric !== "pdf.editor_producer") return measurement.value;
  const producer = measurement.facts.producer;
  if (typeof producer !== "string" || !producer.trim())
    return measurement.value;
  if (matchesAny(producer, rulebook.policy.benignProducers)) return 0;
  return matchesAny(producer, rulebook.policy.editors) ? 1 : 0;
}

/** Whether the file names a producer the Rulebook calls benign (a scanner, a print driver). */
export function benignProducerOf(
  measurements: Measurement[],
  rulebook: Rulebook,
): string | null {
  for (const measurement of measurements) {
    const producer = measurement.facts.producer;
    if (
      typeof producer === "string" &&
      matchesAny(producer, rulebook.policy.benignProducers)
    )
      return producer;
  }
  return null;
}

/** Code's confidence in a Finding, from how far past the threshold it is. Never the model's. */
export function confidenceOf(metric: MetricId, margin: number) {
  const scale = RULE_TEXT[metric].scale;
  if (scale === "count") return margin >= 2 ? 0.97 : 0.92;
  if (scale === "amount") return 0.95;
  // At the threshold 0.5; twice past it 0.75; four times 0.94.
  return Math.min(0.99, Math.max(0.5, 1 - 0.5 ** margin));
}

function weightOf(
  measurement: Measurement,
  ruleWeight: Weight,
  rulebook: Rulebook,
): Weight {
  let weight = ruleWeight;
  // Only a named Check, which anyone can run again, is decisive alone.
  if (
    weight === "decisive" &&
    measurement.check === null &&
    !rulebook.policy.ownCodeDecisive
  )
    weight = "supporting";
  // A pixel effect across most of the page is a re-save, not an edit.
  if (
    weight !== "context" &&
    PIXEL_METRICS.has(measurement.metric) &&
    (measurement.box === null ||
      boxArea(measurement.box) >= rulebook.policy.wholePageShare)
  )
    weight = "context";
  return weight;
}

// Findings ------------------------------------------------------------------------

export type EvaluateInput = {
  measurements: Measurement[];
  hypotheses?: Hypothesis[];
  /** The Examiner's reviews, by Measurement id. */
  reviews?: Record<string, Review>;
  kind: DocumentKind;
  rulebook: Rulebook;
};

const WEIGHT_ORDER: Record<Weight, number> = {
  decisive: 0,
  supporting: 1,
  context: 2,
};

/** Whether a Rule applies to a Document kind. */
export function ruleApplies(
  rulebook: Rulebook,
  metric: MetricId,
  kind: DocumentKind,
) {
  const rule = rulebook.rules[metric];
  return rule.enabled && (rule.kinds.length === 0 || rule.kinds.includes(kind));
}

/** Whether one Measurement trips its Rule, and by how much. */
export function trips(
  measurement: Measurement,
  kind: DocumentKind,
  rulebook: Rulebook,
): { tripped: boolean; value: number; threshold: number; applies: boolean } {
  const rule = rulebook.rules[measurement.metric];
  const value = effectiveValue(measurement, rulebook);
  const applies = ruleApplies(rulebook, measurement.metric, kind);
  return {
    tripped: applies && value >= rule.threshold,
    value,
    threshold: rule.threshold,
    applies,
  };
}

/**
 * The Findings of an Examination: every Measurement that trips its Rule,
 * with Measurements of one Metric on the same place folded into one Finding
 * (the strongest leads). Ordered decisive first, then by confidence.
 */
export function evaluate(input: EvaluateInput): Finding[] {
  const { rulebook, kind } = input;
  const hypotheses = input.hypotheses ?? [];
  const reviews = input.reviews ?? {};
  const findings: Finding[] = [];

  for (const measurement of input.measurements) {
    const verdict = trips(measurement, kind, rulebook);
    if (!verdict.tripped) continue;
    const rule = rulebook.rules[measurement.metric];
    const margin =
      verdict.threshold > 0 ? verdict.value / verdict.threshold : 99;
    const weight = weightOf(measurement, rule.weight, rulebook);
    const same = findings.find(
      (finding) =>
        finding.metric === measurement.metric &&
        finding.page === measurement.page &&
        (finding.box === null || measurement.box === null
          ? finding.box === measurement.box
          : iou(finding.box, measurement.box) >= 0.3),
    );
    if (same) {
      same.measurementIds.push(measurement.id);
      if (!same.foundBy.includes(measurement.finder))
        same.foundBy.push(measurement.finder);
      // The stronger weight wins; within a weight, the larger margin leads.
      const stronger =
        WEIGHT_ORDER[weight] < WEIGHT_ORDER[same.weight] ||
        (weight === same.weight && margin > same.margin);
      if (stronger) {
        Object.assign(same, lead(measurement, verdict, margin, weight));
      }
      continue;
    }
    findings.push({
      ...lead(measurement, verdict, margin, weight),
      ruleId: measurement.metric,
      metric: measurement.metric,
      foundBy: [measurement.finder],
      measurementIds: [measurement.id],
      hypothesisId: null,
      note: null,
      review: null,
    });
  }

  for (const finding of findings) {
    const hypothesis = hypotheses.find(
      (item) =>
        item.status === "supported" &&
        item.measurementIds.some((id) => finding.measurementIds.includes(id)),
    );
    if (hypothesis) {
      finding.hypothesisId = hypothesis.id;
      finding.note = hypothesis.explanation;
    }
    const reviewed = finding.measurementIds.find((id) => reviews[id]);
    if (reviewed) {
      finding.review = reviews[reviewed];
      finding.note ??= reviews[reviewed].note;
    }
  }

  return findings.sort(
    (a, b) =>
      WEIGHT_ORDER[a.weight] - WEIGHT_ORDER[b.weight] ||
      b.confidence - a.confidence ||
      a.page - b.page,
  );
}

function lead(
  measurement: Measurement,
  verdict: { value: number; threshold: number },
  margin: number,
  weight: Weight,
) {
  return {
    id: measurement.id,
    page: measurement.page,
    box: measurement.box,
    value: verdict.value,
    threshold: verdict.threshold,
    margin,
    weight,
    confidence: confidenceOf(measurement.metric, margin),
    detail: measurement.detail,
    facts: measurement.facts,
    layer: measurement.layer,
    layerKind: measurement.layerKind,
    check: measurement.check,
    runId: measurement.runId,
  };
}

// The Verdict ----------------------------------------------------------------------

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** How a Finding reads in a reason: the Rule's label and the value against the threshold. */
export function findingLine(finding: Finding) {
  const unit = METRICS[finding.metric].unit;
  return `${METRICS[finding.metric].label}: measured ${formatThreshold(finding.value)} ${unit} against ${formatThreshold(finding.threshold)}`;
}

/**
 * The Verdict, from the Findings and the Policy alone. A decisive Finding
 * makes a Document Tampered; enough supporting ones do too; fewer make it
 * Suspicious; context Findings never count.
 */
export function decide(findings: Finding[], rulebook: Rulebook): VerdictResult {
  const decisive = findings.filter((finding) => finding.weight === "decisive");
  const supporting = findings.filter(
    (finding) => finding.weight === "supporting",
  );
  const context = findings.filter((finding) => finding.weight === "context");
  const counts = {
    decisive: decisive.length,
    supporting: supporting.length,
    context: context.length,
  };
  const { tamperedAtSupporting, suspiciousAtSupporting } = rulebook.policy;
  if (decisive.length > 0) {
    return {
      verdict: "tampered",
      reasons: [
        ...decisive.map((finding) => `${findingLine(finding)}. Decisive alone.`),
        ...(supporting.length
          ? [`${plural(supporting.length, "supporting Finding")} as well.`]
          : []),
      ],
      ...counts,
    };
  }
  if (supporting.length >= tamperedAtSupporting) {
    return {
      verdict: "tampered",
      reasons: [
        `${plural(supporting.length, "supporting Finding")}; the Rulebook calls a Document Tampered at ${tamperedAtSupporting}.`,
        ...supporting.map((finding) => `${findingLine(finding)}.`),
      ],
      ...counts,
    };
  }
  if (supporting.length >= suspiciousAtSupporting) {
    return {
      verdict: "suspicious",
      reasons: [
        `${plural(supporting.length, "supporting Finding")}: enough to look closer (Suspicious at ${suspiciousAtSupporting}), not enough to call it Tampered (${tamperedAtSupporting}).`,
        ...supporting.map((finding) => `${findingLine(finding)}.`),
      ],
      ...counts,
    };
  }
  return {
    verdict: "genuine",
    reasons: [
      findings.length === 0
        ? "No Measurement tripped a Rule."
        : supporting.length > 0
          ? `${plural(supporting.length, "supporting Finding")}, under the ${suspiciousAtSupporting} the Rulebook asks for.`
          : `${plural(context.length, "Finding")} of context only; none counts toward the Verdict.`,
    ],
    ...counts,
  };
}

// The Done gate ------------------------------------------------------------------

/** The Sweep Findings the Examiner must review: the ones that count toward the Verdict. */
export function findingsToReview(findings: Finding[]) {
  return findings.filter(
    (finding) =>
      finding.weight !== "context" &&
      finding.foundBy.includes("sweep" satisfies Finder) &&
      finding.review === null &&
      finding.hypothesisId === null,
  );
}

export function doneGate(input: {
  pagesTotal: number;
  pagesLooked: number[];
  findings: Finding[];
  hypotheses: Hypothesis[];
}): DoneGate {
  const looked = new Set(
    input.pagesLooked.filter((page) => page >= 1 && page <= input.pagesTotal),
  ).size;
  const findingsOpen = findingsToReview(input.findings).length;
  const hypothesesOpen = input.hypotheses.filter(
    (hypothesis) => hypothesis.status === "open",
  ).length;
  return {
    pagesTotal: input.pagesTotal,
    pagesLooked: looked,
    findingsOpen,
    hypothesesOpen,
    passed:
      looked >= input.pagesTotal && findingsOpen === 0 && hypothesesOpen === 0,
  };
}
