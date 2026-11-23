/**
 * The After-Action Review's numbers: a grade, where the fire peaked, when it
 * was contained, and the Rules. All code; the Comms lead only writes words.
 */
import { type DrillState, heat, mean } from "./engine";
import { checkRules, type Finding } from "./rules";
import { GAUGES, type GaugeId, type Scenario } from "./scenario";

export const GRADES = ["A", "B", "C", "D", "E"] as const;
export type Grade = (typeof GRADES)[number];

/** Heat at or below this counts as contained. */
export const CONTAINED_HEAT = 32;

export type Scorecard = {
  grade: Grade;
  /** 0 to 100, before the grade's cut-offs. */
  score: number;
  findings: Finding[];
  /** Heat after each Round, starting with the heat before the first. */
  heatline: { hour: number; heat: number }[];
  peak: { hour: number; heat: number };
  /** The first hour the heat fell to `CONTAINED_HEAT` and stayed, or null. */
  containedAt: number | null;
  /** The Gauge that ended furthest below where it started. */
  worst: { gauge: GaugeId; by: number };
  cost: number;
  share: number;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

export function scorecard(scenario: Scenario, state: DrillState): Scorecard {
  const findings = checkRules(scenario, state);
  const failed = findings.filter(
    (finding) => finding.status === "missed" || finding.status === "broken",
  ).length;
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(mean(state.gauges) - failed * 5 - state.cost * 0.4 + 8),
    ),
  );
  const grade: Grade =
    score >= 72
      ? "A"
      : score >= 62
        ? "B"
        : score >= 52
          ? "C"
          : score >= 42
            ? "D"
            : "E";

  const heatline = [
    { hour: 0, heat: round1(heat(scenario.start)) },
    ...state.outcomes.map((outcome) => ({
      hour: outcome.hour,
      heat: round1(heat(outcome.after)),
    })),
  ];
  const peak = heatline.reduce((top, point) =>
    point.heat > top.heat ? point : top,
  );
  let containedAt: number | null = null;
  for (let index = heatline.length - 1; index >= 1; index--) {
    const point = heatline[index];
    if (!point || point.heat > CONTAINED_HEAT) break;
    containedAt = point.hour;
  }

  let worst: { gauge: GaugeId; by: number } = { gauge: GAUGES[0], by: 0 };
  for (const gauge of GAUGES) {
    const by = state.gauges[gauge] - scenario.start[gauge];
    if (by < worst.by) worst = { gauge, by };
  }

  return {
    grade,
    score,
    findings,
    heatline,
    peak,
    containedAt,
    worst,
    cost: state.cost,
    share: state.share,
  };
}
