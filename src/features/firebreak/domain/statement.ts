/**
 * The Statement's checks. At the end of a drill the Comms lead drafts the
 * public Statement and code checks it: does it name the people affected, tell
 * them what to do, say when the next update comes, stay off speculation and
 * blame, apologise when the drill went badly, and promise only what the
 * executive actually did. A failed check becomes a Note the model revises
 * against. Only this file passes a Statement.
 */
import type { DrillState } from "./engine";
import { mean } from "./engine";
import type { Scenario } from "./scenario";

export const STATEMENT_WORDS = 120;

export type StatementCheckId =
  | "length"
  | "who"
  | "action"
  | "next-update"
  | "no-speculation"
  | "no-blame"
  | "apology"
  | "promises";

export type StatementNote = {
  check: StatementCheckId;
  /** What the check asks, as a heading. */
  label: string;
  ok: boolean;
  /** For a failure: what to change, as a sentence the model reads. */
  fix: string | null;
  /** For a failure: the words in the draft that broke it, to strike through. */
  quotes: string[];
};

/** Words that guess at a cause before it is known. */
export const SPECULATION = [
  "probably",
  "we believe",
  "we think",
  "likely",
  "may have been caused",
  "appears to have been",
  "rogue",
];

/** Words that put the fault on someone else. */
export const BLAME = [
  "fault",
  "blame",
  "human error",
  "negligence",
  "their failure",
];

const NEXT_UPDATE =
  /\b(\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}:\d{2}|tomorrow|tonight|this (morning|afternoon|evening)|within \d+ (hours?|days?)|every \d+ (hours?|minutes?)|by (noon|midnight|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A word or phrase as a pattern: it must start at a word boundary, and a short
 * word (three letters or fewer) must also end at one, so "app" never matches
 * "apply" while "refund" still matches "refunds".
 */
export function phrase(word: string): RegExp {
  const body = escapeRegExp(word.toLowerCase());
  return new RegExp(word.length <= 3 ? `\\b${body}\\b` : `\\b${body}`, "i");
}

/** Every listed word or phrase that appears in the text, as it appears. */
export function found(text: string, words: string[]): string[] {
  const hits: string[] = [];
  for (const word of words) {
    const match = phrase(word).exec(text);
    if (match) hits.push(text.slice(match.index, match.index + word.length));
  }
  return hits;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Whether the drill went badly enough that the Statement must say sorry. */
export function owesApology(state: DrillState): boolean {
  return state.gauges.customers < 60 || mean(state.gauges) < 60;
}

export function checkStatement(
  scenario: Scenario,
  state: DrillState,
  text: string,
): StatementNote[] {
  const notes: StatementNote[] = [];
  const words = wordCount(text);
  notes.push({
    check: "length",
    label: `${STATEMENT_WORDS} words or fewer`,
    ok: words <= STATEMENT_WORDS && words > 0,
    fix:
      words > STATEMENT_WORDS
        ? `It is ${words} words. Cut it to ${STATEMENT_WORDS} or fewer.`
        : words === 0
          ? "It is empty. Write the Statement."
          : null,
    quotes: [],
  });

  const who = found(text, scenario.statement.who);
  notes.push({
    check: "who",
    label: "Names the people affected",
    ok: who.length > 0,
    fix: who.length
      ? null
      : `Say who is affected, using one of: ${scenario.statement.who.join(", ")}.`,
    quotes: [],
  });

  const action = found(text, scenario.statement.action);
  notes.push({
    check: "action",
    label: "Tells them what to do",
    ok: action.length > 0,
    fix: action.length
      ? null
      : "Tell people one concrete thing to do now (for example: check, call, return, change).",
    quotes: [],
  });

  const next = NEXT_UPDATE.test(text);
  notes.push({
    check: "next-update",
    label: "Says when the next update comes",
    ok: next,
    fix: next
      ? null
      : "Say exactly when the next update will come, with a time (for example: 'at 18:00 today').",
    quotes: [],
  });

  const guesses = found(text, SPECULATION);
  notes.push({
    check: "no-speculation",
    label: "No guessing at causes",
    ok: guesses.length === 0,
    fix: guesses.length
      ? `Remove the guess: ${guesses.map((quote) => `"${quote}"`).join(", ")}. Say only what is known.`
      : null,
    quotes: guesses,
  });

  const blame = found(text, BLAME);
  notes.push({
    check: "no-blame",
    label: "No blame",
    ok: blame.length === 0,
    fix: blame.length
      ? `Remove the blame: ${blame.map((quote) => `"${quote}"`).join(", ")}. Own the response.`
      : null,
    quotes: blame,
  });

  const owes = owesApology(state);
  const sorry = found(text, ["sorry", "apologise", "apologize", "apology"]);
  notes.push({
    check: "apology",
    label: owes ? "Apologises" : "Apology (not required)",
    ok: !owes || sorry.length > 0,
    fix:
      owes && sorry.length === 0
        ? "People were hurt by this and the response was slow. Apologise plainly, once."
        : null,
    quotes: [],
  });

  const broken = scenario.statement.promises.filter(
    (promise) => !(promise.lever in state.taken),
  );
  const unkept = broken.flatMap((promise) => found(text, promise.words));
  notes.push({
    check: "promises",
    label: "Promises only what was done",
    ok: unkept.length === 0,
    fix: unkept.length
      ? `The company did not do this, so the Statement cannot say it: ${unkept
          .map((quote) => `"${quote}"`)
          .join(", ")}.`
      : null,
    quotes: unkept,
  });

  return notes;
}

export const passes = (notes: StatementNote[]) =>
  notes.every((note) => note.ok);
