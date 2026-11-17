import type { Process, Watch } from "./process";
import { checkProcess } from "./process-checks";
import {
  blocking,
  type CheckResult,
  type ReviewFinding,
  type RuleSet,
} from "./rules";
import type { Approval, DeckRound, ExportKind } from "./run";

/*
 * The decisions of the Design and Check loop, as pure functions: whether a
 * Round passed, what the next Round is, and the Approval at the end.
 */

/** How many Rounds the loop may run (Rule `loop.max-rounds`). */
export function maxRounds(rules: RuleSet): number {
  const rounds = rules.get("loop.max-rounds")?.params.rounds;
  return typeof rounds === "number" && rounds >= 1 ? Math.floor(rounds) : 1;
}

/** Whether the reviewer reads the Deck at all (Rule `loop.reviewer`). */
export function reviewerOn(rules: RuleSet): boolean {
  return rules.get("loop.reviewer")?.enabled ?? false;
}

/** Major findings that stop Approval: only while the reviewer Rule blocks. */
export function blockingFindings(
  findings: ReviewFinding[],
  rules: RuleSet,
): ReviewFinding[] {
  const reviewer = rules.get("loop.reviewer");
  if (!reviewer?.enabled || reviewer.severity !== "block") return [];
  return findings.filter((finding) => finding.severity === "major");
}

/** No blocking Check failed and the reviewer raised nothing major that blocks. */
export function roundPassed(
  checks: CheckResult[],
  findings: ReviewFinding[],
  rules: RuleSet,
): boolean {
  return (
    blocking(checks).length === 0 &&
    blockingFindings(findings, rules).length === 0
  );
}

const FIXABLE_BY_RULE = ["layout.", "content.", "motion."];

/** Blocking failures that fitting by rule can repair: layout, content and motion. */
export function fixableByRule(checks: CheckResult[]): CheckResult[] {
  return blocking(checks).filter((check) =>
    FIXABLE_BY_RULE.some((prefix) => check.ruleId.startsWith(prefix)),
  );
}

export type NextMove = "approve" | "hold" | "revise" | "auto-fit";

/**
 * What follows a Round: approve it, hold it (it was the last), or run the
 * next Round, by the model (`revise`) or, when the next Round is the last and
 * fitting by rule is on and can help, by rule (`auto-fit`).
 */
export function nextMove(input: {
  round: number;
  passed: boolean;
  checks: CheckResult[];
  rules: RuleSet;
}): NextMove {
  if (input.passed) return "approve";
  const last = maxRounds(input.rules);
  if (input.round >= last) return "hold";
  const nextIsLast = input.round + 1 >= last;
  const autoFit = input.rules.get("loop.auto-fit")?.enabled ?? false;
  if (nextIsLast && autoFit && fixableByRule(input.checks).length > 0) {
    return "auto-fit";
  }
  return "revise";
}

function where(target: string | null, slides: DeckRound["deck"]["slides"]) {
  if (!target) return "";
  const index = slides.findIndex(
    (slide) => slide.planId === target || slide.id === target,
  );
  return index >= 0 ? ` on slide ${index + 1}` : ` at ${target}`;
}

function sentence(text: string) {
  const trimmed = text.trim().replace(/[.\s]+$/, "");
  return trimmed ? `${trimmed[0].toLowerCase()}${trimmed.slice(1)}` : trimmed;
}

/**
 * The verdict on a Run's Deck: approved when its last Round passed and the
 * Process has no blocking failure, else held, with one sentence a person
 * understands.
 */
export function decideApproval(input: {
  round: DeckRound | null;
  processChecks: CheckResult[];
  rules: RuleSet;
  at: string;
}): Approval {
  const { round, rules, at } = input;
  const title = (ruleId: string) => rules.get(ruleId)?.title ?? ruleId;
  if (!round) {
    return {
      status: "held",
      round: 0,
      at,
      reason: "No Deck was made, so there is nothing to approve.",
    };
  }
  // With every blocking Deck Rule off and the reviewer not blocking, nothing
  // was in a position to refuse the Deck, so nothing can approve it either.
  const reviewer = rules.get("loop.reviewer");
  const gates =
    round.checks.filter((check) => check.severity === "block").length +
    (reviewer?.enabled && reviewer.severity === "block" ? 1 : 0);
  if (gates === 0) {
    return {
      status: "held",
      round: round.round,
      at,
      reason:
        "No blocking Deck Rule was on, so nothing could approve this Deck.",
    };
  }
  const deckFailure = blocking(round.checks)[0];
  if (deckFailure) {
    const failure = deckFailure.failures[0];
    const detail = failure
      ? `${sentence(failure.message)}${where(failure.target, round.deck.slides)}`
      : sentence(deckFailure.summary);
    return {
      status: "held",
      round: round.round,
      at,
      reason: `Round ${round.round} still breaks "${title(deckFailure.ruleId)}": ${detail}.`,
    };
  }
  const major = blockingFindings(round.findings, rules)[0];
  if (major) {
    return {
      status: "held",
      round: round.round,
      at,
      reason: `The reviewer still has a major finding${where(major.target, round.deck.slides)} in Round ${round.round}: ${sentence(major.issue)}.`,
    };
  }
  const processFailure = blocking(input.processChecks)[0];
  if (processFailure) {
    const failure = processFailure.failures[0];
    return {
      status: "held",
      round: round.round,
      at,
      reason: `The Process breaks "${title(processFailure.ruleId)}": ${sentence(failure?.message ?? processFailure.summary)}${failure?.target ? ` (${failure.target})` : ""}.`,
    };
  }
  return {
    status: "approved",
    round: round.round,
    at,
    reason:
      round.round === 1
        ? "The first draft passed every blocking Rule."
        : `Round ${round.round} passed every blocking Rule${round.by === "auto-fit" ? " after fitting by rule" : ""}.`,
  };
}

/** "Round 2: 1 blocking, 2 warnings" for the Check stage. */
export function checkSummary(
  round: number,
  checks: CheckResult[],
  findings: ReviewFinding[],
): string {
  const failed = checks.filter((check) => !check.passed);
  const blockingCount = blocking(checks).length;
  const warnings = failed.length - blockingCount;
  const majors = findings.filter((item) => item.severity === "major").length;
  const parts: string[] = [];
  if (blockingCount > 0) parts.push(`${blockingCount} blocking`);
  if (warnings > 0)
    parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  if (majors > 0)
    parts.push(`${majors} major finding${majors === 1 ? "" : "s"}`);
  return `Round ${round}: ${parts.length > 0 ? parts.join(", ") : "all clear"}`;
}

const GROUNDED = "process.grounded";

/**
 * The Process Checks under the Run's Rules now. A Redo can change the Rules,
 * so the Checks are run again rather than reused. The grounding needs a
 * model, so the result Verify stored is used with the Rule's current
 * severity; when there is none (the Rule was off when the Process was
 * verified) it fails, because nothing checked the steps against the Recording.
 */
export function processChecksUnder(input: {
  process: Process;
  watch: Watch | null;
  /** The grounding Check as Verify computed it, or null if it did not run. */
  grounding: CheckResult | null;
  rules: RuleSet;
}): CheckResult[] {
  const checks = checkProcess(input.process, input.watch, input.rules);
  const rule = input.rules.get(GROUNDED);
  if (!rule?.enabled) return checks;
  return [
    ...checks,
    input.grounding
      ? { ...input.grounding, severity: rule.severity }
      : {
          ruleId: GROUNDED,
          severity: rule.severity,
          passed: false,
          summary:
            "The steps were not checked against the Recording under these Rules",
          failures: [],
        },
  ];
}

/**
 * Why a download is refused, or null. The files are built in the browser,
 * so this is where the server decides: only an approved Deck is a PPTX.
 */
export function exportRefusal(
  kind: unknown,
  run: { hasProcess: boolean; approval: Approval["status"] | null },
): string | null {
  if (kind !== "docx" && kind !== "pptx") return "Pick a DOCX or a PPTX.";
  if (!run.hasProcess) return "This Run has no Process to download yet.";
  if ((kind satisfies ExportKind) === "pptx" && run.approval !== "approved") {
    return "Only an approved Deck downloads as PPTX. Change the Rules and redo the Deck, or read why it was held.";
  }
  return null;
}
