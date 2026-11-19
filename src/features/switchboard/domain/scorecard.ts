/**
 * The Scorecard and the Call's numbers, computed by code from the Call's
 * Events against the Rulebook it ran under. No model takes part: the same
 * Events always give the same Scorecard.
 */
import type {
  CallEvent,
  CallStats,
  CallStatus,
  ScoreItem,
  Scorecard,
} from "./contract";
import { detectLanguage, type Language, mentionedLine, missingLines } from "./hearing";
import {
  list,
  type ResolvedRule,
  type Rulebook,
  ruleDefinition,
  ruleOf,
} from "./rules";

type E<T extends CallEvent["type"]> = Extract<CallEvent, { type: T }>;

const of = <T extends CallEvent["type"]>(events: CallEvent[], type: T) =>
  events.filter((event): event is E<T> => event.type === type);

/** The middle value; null for an empty list. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Nearest-rank percentile; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function callStats(events: CallEvent[], seconds: number): CallStats {
  const callerTurns = of(events, "turn.caller");
  const agentTurns = of(events, "turn.agent");
  const results = of(events, "tool.result");
  const waits = agentTurns
    .map((turn) => turn.data.latency?.firstAudioMs)
    .filter((value): value is number => typeof value === "number");
  const languages: Language[] = [];
  for (const turn of callerTurns) {
    const language = turn.data.language;
    if (language !== "und" && !languages.includes(language))
      languages.push(language);
  }
  return {
    seconds,
    callerTurns: callerTurns.length,
    agentTurns: agentTurns.length,
    bargeIns: of(events, "barge_in").length,
    toolCalls: results.length,
    refusals: results.filter((result) => result.data.refusal.length > 0).length,
    languages,
    firstAudio: {
      turns: waits.length,
      medianMs: median(waits),
      p95Ms: percentile(waits, 95),
      worstMs: waits.length ? Math.max(...waits) : null,
    },
  };
}

const tag = (rule: ResolvedRule) => ({ id: rule.id, version: rule.version });
const titleOf = (rule: ResolvedRule) => ruleDefinition(rule.id)?.title ?? rule.id;

/** Two languages a Caller would call the same: Taglish answers Tagalog. */
const sameTongue = (a: Language, b: Language) =>
  a === b || (a.startsWith("tl") && b.startsWith("tl"));

/**
 * Scores a Call. Rules a Check enforces at the tool boundary cannot be
 * broken, so their item says how often they held; the items that can fail
 * are the ones only the transcript shows: a Disclosure never said, a mention
 * that needed a person and got none, an answer in the wrong language, a Call
 * the server had to cut.
 */
export function scoreCall(
  events: CallEvent[],
  rulebook: Rulebook,
  status: CallStatus,
): Scorecard {
  const results = of(events, "tool.result");
  const callerTurns = of(events, "turn.caller");
  const agentTurns = of(events, "turn.agent");
  const callerText = callerTurns.map((turn) => turn.data.text).join("\n");
  const agentText = agentTurns.map((turn) => turn.data.text).join("\n");
  const heldBy = (ruleId: string) =>
    results.filter((result) =>
      result.data.refusal.some((item) => item.ruleId === ruleId),
    ).length;
  const succeeded = (name: string) =>
    results.filter((result) => result.data.name === name && result.data.ok);
  const times = (count: number) => `${count} time${count === 1 ? "" : "s"}`;
  const items: ScoreItem[] = [];
  const add = (
    rule: ResolvedRule,
    verdict: ScoreItem["verdict"],
    detail: string,
    title = titleOf(rule),
  ) => items.push({ id: rule.id, rule: tag(rule), title, verdict, detail });

  const recording = ruleOf(rulebook, "disclosure.recording");
  if (recording.enabled) {
    const said = missingLines(agentText, list(recording, "listenFor")).length === 0;
    const held = heldBy(recording.id);
    const verified = succeeded("verify_identity").length > 0;
    if (said)
      add(
        recording,
        "pass",
        held
          ? `Said, after the Back office held verify_identity ${times(held)} until it was.`
          : "Said before any identity detail was taken.",
      );
    else if (verified)
      add(recording, "fail", "Identity was verified but the Disclosure is not in the transcript.");
    else
      add(
        recording,
        callerTurns.length > 0 && agentTurns.length > 0 ? "fail" : "na",
        callerTurns.length > 0 && agentTurns.length > 0
          ? "Never said in this Call."
          : "The Call ended before the Agent spoke.",
      );
  }

  const identity = ruleOf(rulebook, "identity.verify");
  if (identity.enabled) {
    const held = heldBy(identity.id);
    const verified = succeeded("verify_identity").length;
    const acted = results.some(
      (result) =>
        result.data.ok &&
        ["rebook", "issue_refund", "issue_voucher", "book_assistance"].includes(
          result.data.name,
        ),
    );
    add(
      identity,
      held || verified || acted ? "pass" : "na",
      held || verified || acted
        ? `${verified ? "Identity verified" : "Identity never verified"}; booking details withheld ${times(held)} before that.`
        : "No booking was looked up in this Call.",
    );
  }

  const refundDisclosure = ruleOf(rulebook, "disclosure.refund");
  const refunds = succeeded("issue_refund").length;
  if (refundDisclosure.enabled) {
    const held = heldBy(refundDisclosure.id);
    add(
      refundDisclosure,
      refunds || held ? "pass" : "na",
      refunds || held
        ? `${times(refunds)} refunded; held ${times(held)} until the Disclosure was said.`
        : "No refund was asked for.",
    );
  }

  for (const id of ["refund.limits", "goodwill.limits", "topics.refused"] as const) {
    const rule = ruleOf(rulebook, id);
    if (!rule.enabled) continue;
    const held = heldBy(id);
    add(
      rule,
      held ? "pass" : "na",
      held ? `Held ${times(held)}; nothing went through above it.` : "Not tested in this Call.",
    );
  }

  const human = ruleOf(rulebook, "human.required");
  if (human.enabled) {
    const mention = mentionedLine(callerText, list(human, "topics"));
    const handedOff = succeeded("hand_off").length > 0;
    const held = heldBy(human.id);
    if (mention)
      add(
        human,
        handedOff ? "pass" : "fail",
        handedOff
          ? "The Caller mentioned something that needs a person, and the Call was handed off."
          : "The Caller mentioned something that needs a person, and no Hand-off was made.",
      );
    else
      add(
        human,
        held ? (handedOff ? "pass" : "fail") : "na",
        held
          ? handedOff
            ? `Held ${times(held)}, then handed off.`
            : `Held ${times(held)}, but no Hand-off was made.`
          : "Nothing in this Call needed a person.",
      );
  }

  const authority = ruleOf(rulebook, "authority.no_override");
  if (authority.enabled) {
    const claim = mentionedLine(callerText, list(authority, "phrases"));
    const held = heldBy(authority.id);
    add(
      authority,
      claim ? "pass" : "na",
      claim
        ? `The Caller claimed authority; ${times(held)} a Refusal named this Rule, and no check was skipped.`
        : "Nobody claimed authority.",
    );
  }

  const length = ruleOf(rulebook, "call.length");
  if (length.enabled)
    add(
      length,
      status === "cut_off" ? "fail" : "pass",
      status === "cut_off"
        ? "The server cut the Call off at its longest length."
        : "Ended inside the limit.",
    );

  // Not a Rule: the Agent is told to follow the Caller's language.
  let checked = 0;
  let wrong = 0;
  let last: Language = "und";
  for (const event of events) {
    if (event.type === "turn.caller") {
      const language = detectLanguage(event.data.text);
      if (language !== "und") last = language;
    } else if (event.type === "turn.agent" && last !== "und") {
      const language = detectLanguage(event.data.text);
      if (language === "und") continue;
      checked++;
      if (!sameTongue(language, last)) wrong++;
    }
  }
  items.push({
    id: "language.followed",
    rule: null,
    title: "Answered in the Caller's language",
    verdict: checked === 0 ? "na" : wrong === 0 ? "pass" : wrong <= 1 ? "pass" : "fail",
    detail:
      checked === 0
        ? "Too little was said to tell."
        : wrong === 0
          ? `All ${checked} Agent Turns matched the Caller's language.`
          : `${wrong} of ${checked} Agent Turns were in another language${wrong <= 1 ? " (the Turn of the switch)" : ""}.`,
  });

  const held = new Map<string, Scorecard["held"][number]>();
  for (const result of results) {
    for (const item of result.data.refusal) {
      const key = `${item.ruleId}@${item.version}`;
      const entry = held.get(key) ?? {
        ruleId: item.ruleId,
        version: item.version,
        title: item.title,
        times: 0,
      };
      entry.times++;
      held.set(key, entry);
    }
  }
  return {
    items,
    passed: items.filter((item) => item.verdict === "pass").length,
    failed: items.filter((item) => item.verdict === "fail").length,
    held: [...held.values()].sort((a, b) => b.times - a.times),
  };
}
