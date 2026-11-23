/**
 * The recorded drill: the same events the routes stream, made in the browser
 * from the Engine and the Scenario's own lines, with no model and no network.
 * It lets a visitor watch a whole drill before taking the chair.
 */
import type { DebriefEvent, TurnEvent } from "../domain/api";
import {
  type DrillState,
  eligibleInjects,
  type Round,
  step,
} from "../domain/engine";
import { roomReporter } from "../domain/reporter";
import { scorecard } from "../domain/review";
import { checkRules } from "../domain/rules";
import type { Scenario } from "../domain/scenario";
import { checkStatement, passes } from "../domain/statement";
import {
  STUB_LESSONS,
  stubDrafts,
  stubReading,
  stubRoom,
} from "../domain/stub";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Stopped", "AbortError"));
    });
  });

export async function* recordedTurn(
  scenario: Scenario,
  state: DrillState,
  current: Omit<Round, "levers">,
  signal: AbortSignal,
): AsyncGenerator<TurnEvent> {
  yield { t: "start", model: "recorded" };
  let levers: string[] = [];
  if (current.choice.kind === "own") {
    await wait(900, signal);
    const reading = stubReading(scenario, current.choice.text);
    levers = reading.levers;
    yield { t: "reading", ...reading };
  }
  await wait(500, signal);
  const next = step(scenario, state, { ...current, levers });
  const outcome = next.outcomes[next.outcomes.length - 1];
  if (!outcome) return;
  yield {
    t: "outcome",
    outcome,
    levers: outcome.levers,
    findings: checkRules(scenario, next),
  };
  const candidates = eligibleInjects(scenario, next);
  const events = roomReporter(candidates)(
    stubRoom(scenario, next, outcome, candidates),
    true,
  );
  for (const event of events) {
    await wait(event.t === "voice" ? 1300 : 700, signal);
    yield event;
  }
  yield { t: "done" };
}

export async function* recordedDebrief(
  scenario: Scenario,
  state: DrillState,
  signal: AbortSignal,
): AsyncGenerator<DebriefEvent> {
  yield { t: "start", model: "recorded" };
  await wait(600, signal);
  yield { t: "scorecard", scorecard: scorecard(scenario, state) };
  await wait(1400, signal);
  yield { t: "lessons", lessons: STUB_LESSONS };
  const drafts = stubDrafts(scenario, state);
  for (const [index, text] of drafts.entries()) {
    await wait(1600, signal);
    const notes = checkStatement(scenario, state, text);
    const passed = passes(notes);
    const final = passed || index === drafts.length - 1;
    yield { t: "draft", n: index + 1, text, final };
    await wait(900, signal);
    yield { t: "notes", n: index + 1, notes, passed };
    if (final) {
      yield { t: "done", passed };
      return;
    }
  }
}
