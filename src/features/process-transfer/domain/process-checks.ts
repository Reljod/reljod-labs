import type { Process, ProcessStep, Watch } from "./process";
import { clock } from "./process";
import type {
  CheckFailure,
  CheckResult,
  ReviewFinding,
  Rule,
  RuleSet,
} from "./rules";
import { RULES } from "./rules";

/*
 * The Checks for every `process.*` Rule: pure functions of the Process, the
 * Watch (for the Recording's length) and the Rule's current Parameters.
 * `process.grounded` is the exception: a reviewer model decides it, and
 * `groundedCheck` only turns its Findings into a result.
 */

/** A result lists at most this many failures; the summary still counts all. */
const MAX_FAILURES = 6;

/** Seconds a step's time may sit past the Recording's end (rounding, the last frame). */
const DURATION_TOLERANCE = 2;

type Outcome = { summary: string; failures: CheckFailure[] };
type CheckFn = (
  process: Process,
  watch: Watch | null,
  params: Record<string, number>,
) => Outcome;

const GROUNDED = "process.grounded";

/**
 * One result per enabled `process.*` Rule except `process.grounded`, in
 * `RULES` order. A disabled or missing Rule gives no result.
 */
export function checkProcess(
  process: Process,
  watch: Watch | null,
  rules: RuleSet,
): CheckResult[] {
  const results: CheckResult[] = [];
  for (const def of RULES) {
    if (def.group !== "process" || def.id === GROUNDED) continue;
    const rule = rules.get(def.id);
    const check = CHECKS[def.id];
    if (!rule?.enabled || !check) continue;
    const { summary, failures } = check(process, watch, rule.params);
    results.push({
      ruleId: rule.id,
      severity: rule.severity,
      passed: failures.length === 0,
      summary,
      failures: failures.slice(0, MAX_FAILURES),
    });
  }
  return results;
}

/**
 * The `process.grounded` result from the reviewer model's Findings: any major
 * Finding fails it; minor ones are counted in the summary and pass.
 */
export function groundedCheck(
  findings: ReviewFinding[],
  rule: Rule | undefined,
): CheckResult | null {
  if (!rule?.enabled) return null;
  const major = findings.filter((item) => item.severity === "major");
  const minor = findings.length - major.length;
  const minorNote =
    minor > 0 ? `; ${plural(minor, "minor point")} to look at` : "";
  const summary =
    major.length === 0
      ? `The reviewer found every step in the Recording${minorNote}`
      : `The reviewer raised ${plural(major.length, "major finding")}${minorNote}`;
  return {
    ruleId: rule.id,
    severity: rule.severity,
    passed: major.length === 0,
    summary,
    failures: major.slice(0, MAX_FAILURES).map((item) => ({
      target: item.target,
      message: `${sentence(item.issue)} Fix: ${sentence(item.fix)}`,
    })),
  };
}

// Checks ---------------------------------------------------------------------

const CHECKS: Record<string, CheckFn> = {
  "process.purpose-and-trigger": (process) => {
    const failures: CheckFailure[] = [];
    if (!filled(process.purpose)) {
      failures.push({
        target: null,
        message:
          "The Process has no purpose. Add a sentence on why it exists, e.g. what goes wrong if nobody does it.",
      });
    }
    if (!filled(process.trigger)) {
      failures.push({
        target: null,
        message:
          "The Process has no trigger. Add what starts it: a date, an event or a request.",
      });
    }
    const missing = [
      filled(process.purpose) ? null : "purpose",
      filled(process.trigger) ? null : "trigger",
    ].filter(Boolean);
    return {
      summary:
        missing.length === 0
          ? "The Process says what it is for and what starts it"
          : `The Process has no ${missing.join(" and no ")}`,
      failures,
    };
  },

  "process.step-count": (process, _watch, params) => {
    const count = process.steps.length;
    const min = params.min ?? 3;
    const max = params.max ?? 20;
    const failures: CheckFailure[] = [];
    if (count < min) {
      failures.push({
        target: null,
        message: `The Process has ${plural(count, "step")}; at least ${min} are needed. Split the broadest step, or check the call really shows a whole procedure.`,
      });
    } else if (count > max) {
      failures.push({
        target: null,
        message: `The Process has ${count} steps; at most ${max} are allowed. Merge steps that happen on the same screen, or split it into two Processes.`,
      });
    }
    return {
      summary:
        failures.length === 0
          ? `${plural(count, "step")}, within ${min} to ${max}`
          : `${plural(count, "step")}, outside ${min} to ${max}`,
      failures,
    };
  },

  "process.step-has-actor": (process) => {
    const roles = process.roles.map((role) => normalName(role.name));
    return perStep(
      process.steps,
      (step) => {
        if (!filled(step.actor)) {
          return `Step ${step.id} names nobody. Set the role that does it, from the Roles list.`;
        }
        if (!roles.includes(normalName(step.actor))) {
          return `Step ${step.id} is done by "${step.actor.trim()}", who is not listed under Roles. Add the role with its responsibility, or use a listed one.`;
        }
        return null;
      },
      {
        allPass: (total) => `All ${plural(total, "step")} name who does them`,
        someFail: (failed, total) =>
          `${failed} of ${plural(total, "step")} ${failed === 1 ? "has" : "have"} no listed role`,
      },
    );
  },

  "process.step-starts-with-verb": (process, _watch, params) => {
    const maxWords = params.maxWords ?? 8;
    return perStep(
      process.steps,
      (step) => {
        const problems: string[] = [];
        const words = wordsOf(step.title);
        if (!startsWithVerb(step.title)) {
          problems.push(
            `does not start with a verb ("${firstWord(step.title) || "empty"}")`,
          );
        }
        if (words.length > maxWords) {
          problems.push(`has ${words.length} words (at most ${maxWords})`);
        }
        if (problems.length === 0) return null;
        return `Step ${step.id}'s title "${step.title.trim()}" ${problems.join(" and ")}. Rewrite it as a short instruction, e.g. "Open the remittance".`;
      },
      {
        allPass: (total) =>
          `All ${plural(total, "step title")} read as short instructions`,
        someFail: (failed, total) =>
          `${failed} of ${plural(total, "step title")} ${failed === 1 ? "does" : "do"} not read as a short instruction`,
      },
    );
  },

  "process.step-has-evidence": (process, watch) => {
    const duration =
      watch &&
      Number.isFinite(watch.durationSeconds) &&
      watch.durationSeconds > 0
        ? watch.durationSeconds
        : null;
    const steps = process.steps;
    // Every step at 0 means the times were never filled in, not that the whole
    // procedure happened in the first second.
    const allAtZero = steps.length > 1 && steps.every((step) => step.at === 0);
    const outcome = perStep(
      steps,
      (step) => {
        if (!Number.isFinite(step.at) || step.at < 0) {
          return `Step ${step.id} has no time in the Recording. Find the moment it is shown and set it.`;
        }
        if (duration !== null && step.at > duration + DURATION_TOLERANCE) {
          return `Step ${step.id} points at ${clock(step.at)}, after the Recording ends at ${clock(duration)}. Set the time where the step is shown.`;
        }
        if (allAtZero) {
          return `Step ${step.id} points at 0:00, like every other step. Set the time where it is shown.`;
        }
        return null;
      },
      {
        allPass: (total) =>
          `All ${plural(total, "step")} point at a time in the Recording`,
        someFail: (failed, total) =>
          `${failed} of ${plural(total, "step")} ${failed === 1 ? "has" : "have"} no time in the Recording`,
      },
    );
    if (allAtZero) {
      return {
        summary: `All ${steps.length} steps point at 0:00, so none shows where it happens`,
        failures: outcome.failures,
      };
    }
    return outcome;
  },

  "process.steps-in-order": (process, _watch, params) => {
    const tolerance = params.toleranceSeconds ?? 15;
    const failures: CheckFailure[] = [];
    process.steps.forEach((step, index) => {
      const before = process.steps[index - 1];
      if (!before || !Number.isFinite(step.at) || !Number.isFinite(before.at)) {
        return;
      }
      const back = before.at - step.at;
      if (back > tolerance) {
        failures.push({
          target: step.id,
          message: `Step ${step.id} (${clock(step.at)}) comes ${Math.round(back)} s before step ${before.id} (${clock(before.at)}) in the Recording. Check the order of the steps or the time of one of them.`,
        });
      }
    });
    return {
      summary:
        failures.length === 0
          ? "The steps follow the Recording"
          : `${plural(failures.length, "step")} ${failures.length === 1 ? "runs" : "run"} backwards in the Recording by more than ${tolerance} s`,
      failures,
    };
  },

  "process.step-length": (process, _watch, params) => {
    const maxWords = params.maxWords ?? 60;
    return perStep(
      process.steps,
      (step) => {
        const count = wordsOf(step.action).length;
        if (count <= maxWords) return null;
        return `Step ${step.id}'s instruction has ${count} words (at most ${maxWords}). Move fields and values to its details, or split the step.`;
      },
      {
        allPass: (total) =>
          `All ${plural(total, "instruction")} have at most ${maxWords} words`,
        someFail: (failed, total) =>
          `${failed} of ${plural(total, "instruction")} ${failed === 1 ? "is" : "are"} longer than ${maxWords} words`,
      },
    );
  },

  "process.systems-named": (process) => {
    const listed = process.systems.map((system) => normalName(system.name));
    const used = process.steps.filter((step) => filled(step.system));
    const outcome = perStep(
      used,
      (step) => {
        const name = normalName(step.system ?? "");
        // "PensionPro (Reconciliation)" or "PensionPro > Import" is PensionPro.
        const known = listed.some(
          (item) =>
            item === name ||
            (name.startsWith(item) && /^\W/.test(name.slice(item.length))),
        );
        if (known) return null;
        return `Step ${step.id} uses "${(step.system ?? "").trim()}", which is not listed under Systems. Add it with what it is used for, or use the listed name.`;
      },
      {
        allPass: (total) =>
          total === 0
            ? "No step names a system"
            : `Every system the steps use is listed (${plural(total, "step")} checked)`,
        someFail: (failed, total) =>
          `${failed} of ${plural(total, "step")} that use a system name one that is not listed`,
      },
    );
    return outcome;
  },

  "process.decisions-have-branches": (process, _watch, params) => {
    const minBranches = params.minBranches ?? 2;
    const deciding = process.steps.filter((step) => step.decision);
    return perStep(
      deciding,
      (step) => {
        const decision = step.decision;
        if (!decision) return null;
        const complete = decision.branches.filter(
          (branch) => filled(branch.when) && filled(branch.then),
        );
        if (!filled(decision.question)) {
          return `Step ${step.id}'s decision has no question. Write the question that decides the path.`;
        }
        if (complete.length < minBranches) {
          return `Step ${step.id}'s decision "${decision.question.trim()}" gives ${plural(complete.length, "complete branch", "complete branches")}; at least ${minBranches} are needed, each with a condition and what to do.`;
        }
        return null;
      },
      {
        allPass: (total) =>
          total === 0
            ? "No step makes a decision"
            : `${total === 1 ? "The decision gives" : `All ${total} decisions give`} at least ${minBranches} branches`,
        someFail: (failed, total) =>
          `${failed} of ${plural(total, "decision")} ${failed === 1 ? "gives" : "give"} fewer than ${minBranches} complete branches`,
      },
    );
  },
};

// Helpers --------------------------------------------------------------------

/** Applies `fail` to each step; a string is the failure's message. */
function perStep(
  steps: ProcessStep[],
  fail: (step: ProcessStep) => string | null,
  summaries: {
    allPass: (total: number) => string;
    someFail: (failed: number, total: number) => string;
  },
): Outcome {
  const failures: CheckFailure[] = [];
  for (const step of steps) {
    const message = fail(step);
    if (message) failures.push({ target: step.id, message });
  }
  return {
    summary:
      failures.length === 0
        ? summaries.allPass(steps.length)
        : summaries.someFail(failures.length, steps.length),
    failures,
  };
}

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * A name as compared between a step and the Roles or Systems list: case,
 * spacing, a leading "the" and a plural "s" do not matter, so "the pensions
 * officers" is "Pensions Officer".
 */
export function normalName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/[.,;:]+$/, "")
    .replace(/([^s])s$/, "$1");
}

function firstWord(title: string): string {
  return (
    wordsOf(title)[0]?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, "") ?? ""
  );
}

/*
 * "Starts with a verb", without a part-of-speech tagger. English imperatives
 * have no marker, so this is a heuristic in three passes over the first word:
 *
 * 1. Known procedure verbs (below) pass: "Open", "Re-run", "Log", "Post".
 * 2. Obvious non-verbs fail: articles, determiners, pronouns, prepositions and
 *    connectives ("The", "Each", "When"); numbers and step labels ("1.",
 *    "Step"); product names in CamelCase or capitals ("PensionPro", "CSV");
 *    gerunds and past or third-person forms ("Downloading", "Downloaded",
 *    "Opens"); and noun endings ("Reconciliation", "Approval", "Payment").
 * 3. Anything else passes, so an unusual but real verb ("Triage") is not
 *    flagged.
 *
 * Where it is weak: a noun with no telltale ending passes ("Statement
 * download"); a hyphenated word passes only as a known prefix and a listed
 * verb ("Re-run", "Double-check"), so "Month-end close" fails as it should;
 * verbs that look like nouns and are not listed fail ("Station the cart");
 * and words that are both ("Report", "Request") always pass. The Rule is a
 * `warn`, so a wrong call costs a glance, not an Approval.
 */
export function startsWithVerb(title: string): boolean {
  const raw = firstWord(title);
  if (!raw) return false;
  if (/^\d/.test(raw)) return false;
  // CamelCase or an acronym: a product name, not an instruction.
  if (/^\p{Lu}{2,}$/u.test(raw) || /\p{Ll}\p{Lu}/u.test(raw)) return false;
  const word = raw.toLowerCase();
  if (VERBS.has(word)) return true;
  if (word.includes("-")) {
    const [prefix, rest] = [
      word.slice(0, word.indexOf("-")),
      word.slice(word.indexOf("-") + 1),
    ];
    return VERB_PREFIXES.has(prefix) && VERBS.has(rest);
  }
  if (NOT_VERBS.has(word)) return false;
  if (/(ing|ed)$/.test(word)) return false;
  if (/[^s]s$/.test(word)) return false;
  if (NOUN_ENDING.test(word)) return false;
  return true;
}

const NOUN_ENDING =
  /(tion|sion|ment|ness|ity|ance|ence|ship|ism|ist|al|ure|ery|ory|or|er|ee|age|ics|ware|log)$/;

const VERB_PREFIXES = new Set(["re", "pre", "double", "cross"]);

const NOT_VERBS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "each",
  "every",
  "all",
  "any",
  "some",
  "no",
  "my",
  "our",
  "your",
  "his",
  "her",
  "its",
  "their",
  "i",
  "we",
  "you",
  "he",
  "she",
  "it",
  "they",
  "someone",
  "somebody",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "into",
  "onto",
  "via",
  "per",
  "when",
  "if",
  "then",
  "after",
  "before",
  "once",
  "while",
  "and",
  "or",
  "but",
  "so",
  "first",
  "next",
  "finally",
  "now",
  "also",
  "please",
  "step",
  "new",
  "monthly",
  "daily",
  "weekly",
  "month",
  "month-end",
  "year-end",
  "end",
  "data",
  "summary",
  "how",
  "what",
  "why",
  "who",
  "where",
]);

/** Common verbs in written procedures, as imperatives. */
const VERBS = new Set([
  "accept",
  "access",
  "action",
  "add",
  "adjust",
  "advance",
  "agree",
  "allocate",
  "alter",
  "amend",
  "answer",
  "apply",
  "approve",
  "archive",
  "ask",
  "assign",
  "assist",
  "attach",
  "authorise",
  "authorize",
  "back",
  "balance",
  "book",
  "bring",
  "build",
  "calculate",
  "call",
  "cancel",
  "capture",
  "carry",
  "change",
  "chase",
  "check",
  "choose",
  "clear",
  "click",
  "close",
  "collect",
  "comment",
  "compare",
  "compile",
  "complete",
  "configure",
  "confirm",
  "consider",
  "contact",
  "copy",
  "correct",
  "cover",
  "create",
  "credit",
  "debit",
  "decide",
  "delete",
  "deliver",
  "deposit",
  "describe",
  "determine",
  "discover",
  "distribute",
  "do",
  "document",
  "download",
  "draft",
  "edit",
  "email",
  "embed",
  "engage",
  "enhance",
  "ensure",
  "enter",
  "escalate",
  "establish",
  "estimate",
  "examine",
  "exceed",
  "export",
  "extract",
  "feed",
  "file",
  "fill",
  "filter",
  "finalise",
  "finalize",
  "find",
  "fix",
  "flag",
  "focus",
  "follow",
  "forward",
  "gather",
  "generate",
  "get",
  "give",
  "go",
  "handle",
  "hold",
  "identify",
  "implement",
  "import",
  "inform",
  "input",
  "inspect",
  "investigate",
  "issue",
  "keep",
  "label",
  "launch",
  "leave",
  "list",
  "load",
  "locate",
  "lock",
  "log",
  "look",
  "lower",
  "mail",
  "make",
  "manage",
  "map",
  "mark",
  "match",
  "measure",
  "mention",
  "merge",
  "monitor",
  "move",
  "need",
  "note",
  "notify",
  "obtain",
  "offer",
  "open",
  "order",
  "pass",
  "pay",
  "phone",
  "pick",
  "place",
  "plan",
  "post",
  "prepare",
  "press",
  "print",
  "proceed",
  "process",
  "procure",
  "produce",
  "provide",
  "publish",
  "pull",
  "put",
  "query",
  "question",
  "raise",
  "read",
  "receive",
  "reconcile",
  "reconfirm",
  "record",
  "recover",
  "refer",
  "refresh",
  "refund",
  "register",
  "reject",
  "release",
  "remind",
  "remove",
  "rename",
  "render",
  "repeat",
  "reply",
  "report",
  "request",
  "resolve",
  "respond",
  "restart",
  "retrieve",
  "return",
  "review",
  "run",
  "save",
  "scan",
  "schedule",
  "score",
  "screen",
  "search",
  "secure",
  "select",
  "send",
  "set",
  "share",
  "shred",
  "sign",
  "sort",
  "split",
  "start",
  "stop",
  "store",
  "submit",
  "summarise",
  "summarize",
  "switch",
  "take",
  "tell",
  "test",
  "tick",
  "total",
  "track",
  "transfer",
  "triage",
  "type",
  "update",
  "upload",
  "use",
  "validate",
  "verify",
  "view",
  "wait",
  "work",
  "write",
  "zip",
]);
