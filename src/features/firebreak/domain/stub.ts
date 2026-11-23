/**
 * Canned model output, written from the Scenario's own lines. The recorded
 * drill plays it in the browser with no model and no network; the end-to-end
 * test gets it from the real routes under the e2e bypass. Everything else
 * (the Engine, the Rules, the Statement's checks) runs for real either way.
 */
import type { Headline, Post, Voice } from "./api";
import type { Reading } from "./brief";
import { type DrillState, injectById, type Outcome } from "./engine";
import { GAUGES, type Inject, type Scenario } from "./scenario";
import { BLAME, found, phrase, SPECULATION } from "./statement";

export type RoomOutput = {
  voices: Voice[];
  headline: Headline;
  posts: Post[];
  whisper: string;
  next: string | null;
};

/** Finds Levers whose label or id words appear in the text. */
export function stubReading(scenario: Scenario, text: string): Reading {
  const levers = scenario.levers
    .filter((lever) =>
      [lever.label, lever.id.replace(/_/g, " ")].some((words) =>
        words
          .toLowerCase()
          .split(/\s+/)
          .filter((word) => word.length > 4)
          .some((word) => phrase(word).test(text)),
      ),
    )
    .slice(0, 3)
    .map((lever) => lever.id);
  return {
    heard: `You decided: ${text.trim().slice(0, 120)}`,
    levers,
    outside: levers.length ? null : "Nothing the drill can act on.",
  };
}

const POSTS = {
  up: [
    {
      handle: "harbourlights",
      text: "Honestly? Better than I expected. They actually told us something.",
    },
    {
      handle: "meridian_mum",
      text: "Clear answer, clear next step. Why is that so rare.",
    },
  ],
  down: [
    {
      handle: "kesselcommuter",
      text: "Still nothing. Still waiting. Still paying for this.",
    },
    {
      handle: "portmeridian_ed",
      text: "Every hour they say nothing is an hour somebody guesses for them.",
    },
  ],
};

export function stubRoom(
  scenario: Scenario,
  _state: DrillState,
  outcome: Outcome,
  candidates: Inject[],
): RoomOutput {
  const moved = [...GAUGES]
    .filter((gauge) => outcome.delta[gauge] !== 0)
    .sort((a, b) => Math.abs(outcome.delta[b]) - Math.abs(outcome.delta[a]))
    .slice(0, 3);
  const order = moved.length ? moved : [GAUGES[0]];
  const voices = order.map((gauge): Voice => {
    const person = scenario.stakeholders.find((s) => s.gauge === gauge);
    const up = outcome.delta[gauge] >= 0;
    const lines = up ? person?.lines.up : person?.lines.down;
    const line = lines?.[outcome.slot % (lines?.length || 1)] ?? "…";
    const mood = Math.max(
      -2,
      Math.min(2, Math.round(outcome.delta[gauge] / 6)),
    );
    return { who: gauge, line, mood };
  });
  const better = outcome.after && sumDelta(outcome) >= 0;
  const press = scenario.stakeholders.find((s) => s.gauge === "press");
  const inject = injectById(scenario, outcome.inject);
  const next = candidates[0] ?? null;
  const from = next
    ? scenario.stakeholders.find((s) => s.gauge === next.from)?.name
    : null;
  return {
    voices,
    headline: {
      outlet: press?.role.split(",")[0] ?? "Meridia Wire",
      text: better
        ? `${scenario.company} moves fast as ${inject?.title.toLowerCase()}`
        : `Pressure mounts on ${scenario.company}: ${inject?.title.toLowerCase()}`,
    },
    posts: better ? POSTS.up : POSTS.down,
    whisper: from
      ? `Heads up: ${from} will want you next.`
      : `Seventy-two hours. Whatever you said, they'll quote it for years.`,
    next: next?.id ?? null,
  };
}

function sumDelta(outcome: Outcome) {
  return GAUGES.reduce((sum, gauge) => sum + outcome.delta[gauge], 0);
}

/**
 * Two drafts: the first breaks two checks on purpose (a guess at the cause
 * and no time for the next update), the second fixes them, so the revision
 * loop has something to show.
 */
export function stubDrafts(scenario: Scenario, state: DrillState): string[] {
  const who = scenario.statement.who[0] ?? "customer";
  const did = Object.keys(state.taken)
    .map((id) => scenario.levers.find((lever) => lever.id === id)?.label)
    .filter(
      (label): label is string =>
        Boolean(label) &&
        found(label as string, [...BLAME, ...SPECULATION]).length === 0,
    )
    .slice(0, 3)
    .map((label) => label.toLowerCase());
  const body = `To every ${who} affected since ${scenario.startsAt}: we are sorry. ${scenario.logline} So far we have chosen to ${did.join("; ") || "investigate"}. If you are affected, please check our website or call our line now.`;
  return [
    `${body} The cause was probably a single weak point, and we are reviewing it.`,
    `${body} We will publish the next update at 18:00 today.`,
  ];
}

export const STUB_LESSONS = [
  "The first hour decides the story; we were judged on what we said before we knew everything.",
  "People forgave the problem faster than the silence around it.",
  "Our deadlines live in law and policy; the drill showed which ones we did not know by heart.",
];
