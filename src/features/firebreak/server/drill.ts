import "server-only";
import { createGateway, Output, streamText } from "ai";
import type {
  DebriefEvent,
  DebriefRequest,
  TurnEvent,
  TurnRequest,
  Usage,
} from "../domain/api";
import {
  COMMS_INSTRUCTIONS,
  cleanLessons,
  cleanReading,
  cleanStatement,
  commsPrompt,
  draftSchema,
  READER_INSTRUCTIONS,
  REVISE_INSTRUCTIONS,
  type Reading,
  ROOM_INSTRUCTIONS,
  readerPrompt,
  readerSchema,
  revisePrompt,
  reviseSchema,
  roomPrompt,
  roomSchema,
} from "../domain/brief";
import {
  type DrillState,
  eligibleInjects,
  injectById,
  play,
  type Round,
  step,
} from "../domain/engine";
import { LIMITS } from "../domain/limits";
import { roomReporter } from "../domain/reporter";
import { scorecard } from "../domain/review";
import { checkRules } from "../domain/rules";
import type { Inject, Scenario } from "../domain/scenario";
import { scenarioById } from "../domain/scenarios";
import { checkStatement, passes } from "../domain/statement";
import {
  STUB_LESSONS,
  stubDrafts,
  stubReading,
  stubRoom,
} from "../domain/stub";
import { env } from "./env";
import { InvalidError } from "./errors";

type Options = { stub: boolean; signal: AbortSignal };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function gatewayCost(providerMetadata: unknown): number | null {
  const meta = isRecord(providerMetadata)
    ? providerMetadata.gateway
    : undefined;
  if (!isRecord(meta)) return null;
  for (const value of [meta.cost, meta.marketCost]) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number === "number" && Number.isFinite(number)) return number;
  }
  return null;
}

const gateway = () => createGateway({ apiKey: env.aiGatewayApiKey() });

const signalFor = (options: Options) =>
  AbortSignal.any([options.signal, AbortSignal.timeout(LIMITS.seconds * 1000)]);

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function scenarioOf(id: string): Scenario {
  const scenario = scenarioById(id);
  if (!scenario) throw new InvalidError("There is no drill by that name.");
  return scenario;
}

/* ------------------------------------------------------------------ Turn */

export type PreparedTurn = {
  scenario: Scenario;
  state: DrillState;
  inject: Inject;
  request: TurnRequest;
};

/**
 * Checks a Turn before anything is spent: the Scenario exists, the Rounds so
 * far replay (so they are Rounds the Engine could have produced), the drill
 * is not over, and the Inject on the desk could have landed now.
 */
export function prepareTurn(request: TurnRequest): PreparedTurn {
  const scenario = scenarioOf(request.scenario);
  const state = play(scenario, request.rounds);
  if (state.done)
    throw new InvalidError("This drill is over. Open the Review.");
  const inject = injectById(scenario, request.current.inject);
  if (!inject || !eligibleInjects(scenario, state).includes(inject))
    throw new InvalidError("That Inject could not be on the desk now.");
  if (
    request.current.choice.kind === "option" &&
    !inject.options.some(
      (o) => o.id === (request.current.choice as { option: string }).option,
    )
  )
    throw new InvalidError("That option is not on this card.");
  return { scenario, state, inject, request };
}

async function read(
  prepared: PreparedTurn,
  text: string,
  options: Options,
): Promise<{ reading: Reading; usage: Usage | null }> {
  const { scenario, inject } = prepared;
  if (options.stub)
    return { reading: stubReading(scenario, text), usage: null };
  const started = Date.now();
  const model = env.model();
  const result = streamText({
    model: gateway()(model),
    instructions: READER_INSTRUCTIONS,
    output: Output.object({ schema: readerSchema(scenario) }),
    reasoning: env.reasoning(),
    maxOutputTokens: LIMITS.outputTokens,
    abortSignal: signalFor(options),
    prompt: readerPrompt(scenario, inject, text),
  });
  const [output, usage, metadata] = await Promise.all([
    result.output,
    result.usage,
    result.providerMetadata,
  ]);
  return {
    reading: cleanReading(scenario, output),
    usage: {
      call: "reader",
      model,
      ms: Date.now() - started,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      costUsd: gatewayCost(metadata),
    },
  };
}

/**
 * Runs one Round: reads the executive's own words into Levers (if they wrote
 * any), lets the Engine play the Round, then lets the Room speak and pick the
 * next Inject. The caller has passed the gate, prepared the Turn and taken
 * the rate.
 */
export async function* runTurn(
  prepared: PreparedTurn,
  options: Options,
): AsyncGenerator<TurnEvent> {
  const { scenario, request } = prepared;
  const model = options.stub ? "stub" : env.model();
  yield { t: "start", model };

  let levers: string[] = [];
  const choice = request.current.choice;
  if (choice.kind === "own") {
    const { reading, usage } = await read(prepared, choice.text, options);
    levers = reading.levers;
    yield { t: "reading", ...reading };
    if (usage) yield { t: "usage", usage };
  }

  const round: Round = { inject: request.current.inject, choice, levers };
  const state = step(scenario, prepared.state, round);
  const outcome = state.outcomes[state.outcomes.length - 1];
  if (!outcome) throw new Error("The Engine returned no outcome.");
  yield {
    t: "outcome",
    outcome,
    levers: outcome.levers,
    findings: checkRules(scenario, state),
  };

  const candidates = eligibleInjects(scenario, state);
  const report = roomReporter(candidates);

  if (options.stub) {
    const canned = stubRoom(scenario, state, outcome, candidates);
    for (const event of report(canned, true)) {
      if (options.signal.aborted) return;
      await pause(60);
      yield event;
    }
    yield { t: "done" };
    return;
  }

  const started = Date.now();
  const result = streamText({
    model: gateway()(model),
    instructions: ROOM_INSTRUCTIONS,
    output: Output.object({ schema: roomSchema(candidates) }),
    reasoning: env.reasoning(),
    maxOutputTokens: LIMITS.outputTokens,
    abortSignal: signalFor(options),
    prompt: roomPrompt({
      scenario,
      state,
      outcome,
      rounds: [...request.rounds, round],
      echoes: request.echoes,
      candidates,
    }),
  });
  for await (const partial of result.partialOutputStream) {
    for (const event of report(partial, false)) yield event;
  }
  const output = await result.output;
  for (const event of report(output, true)) yield event;
  const [usage, metadata] = await Promise.all([
    result.usage,
    result.providerMetadata,
  ]);
  yield {
    t: "usage",
    usage: {
      call: "room",
      model,
      ms: Date.now() - started,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      costUsd: gatewayCost(metadata),
    },
  };
  yield { t: "done" };
}

/* --------------------------------------------------------------- Debrief */

export type PreparedDebrief = {
  scenario: Scenario;
  state: DrillState;
  request: DebriefRequest;
};

/** A Review needs a finished drill that replays. */
export function prepareDebrief(request: DebriefRequest): PreparedDebrief {
  const scenario = scenarioOf(request.scenario);
  const state = play(scenario, request.rounds);
  if (!state.done)
    throw new InvalidError("Finish the drill before the Review.");
  return { scenario, state, request };
}

/**
 * The Review: code grades the drill and checks every Rule, then the Comms
 * lead drafts the Statement and revises it until it passes the checks in
 * `statement.ts` or runs out of drafts.
 */
export async function* runDebrief(
  prepared: PreparedDebrief,
  options: Options,
): AsyncGenerator<DebriefEvent> {
  const { scenario, state, request } = prepared;
  const model = options.stub ? "stub" : env.model();
  yield { t: "start", model };
  const card = scorecard(scenario, state);
  yield { t: "scorecard", scorecard: card };

  const canned = options.stub ? stubDrafts(scenario, state) : [];
  let draft = "";
  let passed = false;

  for (let n = 1; n <= LIMITS.drafts; n++) {
    const started = Date.now();
    if (options.stub) {
      await pause(300);
      draft = canned[Math.min(n - 1, canned.length - 1)] ?? "";
      if (n === 1) yield { t: "lessons", lessons: STUB_LESSONS };
    } else {
      const result = streamText({
        model: gateway()(model),
        instructions: n === 1 ? COMMS_INSTRUCTIONS : REVISE_INSTRUCTIONS,
        output: Output.object({ schema: n === 1 ? draftSchema : reviseSchema }),
        reasoning: env.reasoning(),
        maxOutputTokens: LIMITS.outputTokens,
        abortSignal: signalFor(options),
        prompt:
          n === 1
            ? commsPrompt({
                scenario,
                state,
                rounds: request.rounds,
                echoes: request.echoes,
                card,
              })
            : revisePrompt(draft, checkStatement(scenario, state, draft)),
      });
      const [output, usage, metadata] = await Promise.all([
        result.output,
        result.usage,
        result.providerMetadata,
      ]);
      draft = cleanStatement(output);
      if (n === 1) yield { t: "lessons", lessons: cleanLessons(output) };
      yield {
        t: "usage",
        usage: {
          call: "draft",
          model,
          ms: Date.now() - started,
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          costUsd: gatewayCost(metadata),
        },
      };
    }
    const notes = checkStatement(scenario, state, draft);
    passed = passes(notes);
    const final = passed || n === LIMITS.drafts;
    yield { t: "draft", n, text: draft, final };
    yield { t: "notes", n, notes, passed };
    if (final) break;
  }
  yield { t: "done", passed };
}
