/**
 * The Engine: a drill is a pure function of its Rounds. Given a Scenario and
 * the decisions made so far, `play` returns where every Gauge stands, what
 * the crisis has cost and what happened in each Round, step by step. Nothing
 * else changes a number: the model voices the Stakeholders and picks the next
 * Inject from the ones the Engine allows, and that is all it does.
 *
 * Because the drill is replayed from its Rounds on every request, the server
 * keeps no state: the browser sends the Rounds back and the server plays them
 * again, refusing any it could not have produced.
 */
import {
  type Effects,
  GAUGES,
  type GaugeId,
  type Gauges,
  type Inject,
  type Lever,
  type Scenario,
} from "./scenario";

/** How a decision was made: one of the Inject's Options, or the executive's own words. */
export type Choice =
  | { kind: "option"; option: string }
  | { kind: "own"; text: string };

/** One decided Round: the Inject that landed, the Choice, and the Levers it pulled. */
export type Round = { inject: string; choice: Choice; levers: string[] };

/** One thing that moved the Gauges in a Round, after any lateness. */
export type Step = {
  source: "inject" | "lever" | "burn";
  id: string;
  label: string;
  effects: Effects;
  /** A Lever pulled after its best-by hour: its gains were cut. */
  late?: boolean;
  /** A Lever that had already been pulled: it did nothing. */
  repeat?: boolean;
};

export type Outcome = {
  slot: number;
  hour: number;
  inject: string;
  levers: string[];
  steps: Step[];
  /** Where each Gauge ended, minus where it started the Round (after clamping). */
  delta: Gauges;
  before: Gauges;
  after: Gauges;
  /** Florin millions this Round cost. */
  cost: number;
  share: number;
};

export type DrillState = {
  scenario: string;
  /** The next Slot to be played; equal to `slots.length` when the drill is over. */
  slot: number;
  /** The hour of the last Round played (0 before any). */
  hour: number;
  gauges: Gauges;
  /** Florin millions spent or lost so far. */
  cost: number;
  /** The share price as an index, 100 at the start. */
  share: number;
  /** Each Lever pulled, with the hour it was pulled. */
  taken: Record<string, number>;
  outcomes: Outcome[];
  done: boolean;
};

/** A Round the Engine could not have produced. Routes answer 400. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

/** The most Levers one Round may pull. */
export const MAX_LEVERS = 3;

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

export function mean(gauges: Gauges): number {
  return GAUGES.reduce((sum, gauge) => sum + gauges[gauge], 0) / GAUGES.length;
}

/** Heat is what a Gauge has lost to the fire: 100 minus the Gauge. */
export function heat(gauges: Gauges): number {
  return 100 - mean(gauges);
}

/** The share index: confidence moves it, cost drags it. */
export function sharePrice(
  scenario: Scenario,
  gauges: Gauges,
  cost: number,
): number {
  return round1(
    100 +
      (mean(gauges) - mean(scenario.start)) * 0.5 -
      cost * scenario.costToShare,
  );
}

export function initialState(scenario: Scenario): DrillState {
  return {
    scenario: scenario.id,
    slot: 0,
    hour: 0,
    gauges: { ...scenario.start },
    cost: 0,
    share: 100,
    taken: {},
    outcomes: [],
    done: false,
  };
}

/** Whether an Inject's Condition holds in this state. */
function holds(inject: Inject, state: DrillState): boolean {
  const when = inject.when;
  if (!when) return true;
  if (when.taken?.some((lever) => !(lever in state.taken))) return false;
  if (when.notTaken?.some((lever) => lever in state.taken)) return false;
  if (when.below) {
    for (const [gauge, line] of Object.entries(when.below)) {
      if (state.gauges[gauge as GaugeId] >= (line ?? 0)) return false;
    }
  }
  return true;
}

/**
 * The Injects that may land next, in deck order. The Room picks one; without
 * the Room (the stub, the recorded drill, a model failure) the first is used.
 */
export function eligibleInjects(
  scenario: Scenario,
  state: DrillState,
): Inject[] {
  if (state.slot >= scenario.slots.length) return [];
  return scenario.injects.filter(
    (inject) => inject.slot === state.slot && holds(inject, state),
  );
}

export function leverById(scenario: Scenario, id: string): Lever | undefined {
  return scenario.levers.find((lever) => lever.id === id);
}

export function injectById(scenario: Scenario, id: string): Inject | undefined {
  return scenario.injects.find((inject) => inject.id === id);
}

/**
 * The Levers a Choice pulls. An Option's are fixed by the Scenario; the
 * executive's own words carry the Levers the Reader found in them, which are
 * checked against the Scenario here.
 */
export function leversOf(
  scenario: Scenario,
  inject: Inject,
  choice: Choice,
  read: string[] = [],
): string[] {
  if (choice.kind === "option") {
    const option = inject.options.find((item) => item.id === choice.option);
    if (!option)
      throw new EngineError("That option is not on this Inject's card.");
    return option.levers;
  }
  const unique = [...new Set(read)];
  if (unique.length > MAX_LEVERS)
    throw new EngineError(`A Round pulls at most ${MAX_LEVERS} Levers.`);
  for (const id of unique) {
    if (!leverById(scenario, id))
      throw new EngineError(`There is no Lever called ${id}.`);
  }
  return unique;
}

/** A Lever's effects at an hour: gains shrink once it is late, costs never do. */
export function effectsAt(
  lever: Lever,
  hour: number,
): { effects: Effects; late: boolean } {
  const late = lever.late !== undefined && hour > lever.late.after;
  if (!late || !lever.late) return { effects: { ...lever.effects }, late };
  const factor = lever.late.factor;
  const effects: Effects = {};
  for (const [key, value] of Object.entries(lever.effects)) {
    if (value === undefined) continue;
    effects[key as keyof Effects] =
      key !== "cost" && value > 0 ? round1(value * factor) : value;
  }
  return { effects, late };
}

function apply(gauges: Gauges, effects: Effects): number {
  for (const gauge of GAUGES) {
    const change = effects[gauge];
    if (change) gauges[gauge] += change;
  }
  return effects.cost ?? 0;
}

/** Plays one Round on a state, returning the next state. Throws EngineError on an impossible Round. */
export function step(
  scenario: Scenario,
  state: DrillState,
  round: Round,
): DrillState {
  if (state.done) throw new EngineError("The drill is already over.");
  const inject = injectById(scenario, round.inject);
  if (!inject || !eligibleInjects(scenario, state).includes(inject))
    throw new EngineError("That Inject could not have landed now.");
  // An Option's Levers come from the Scenario, whatever the Round says.
  const levers = leversOf(scenario, inject, round.choice, round.levers);

  const hour = scenario.slots[state.slot] ?? state.hour;
  const raw: Gauges = { ...state.gauges };
  const taken = { ...state.taken };
  const steps: Step[] = [];
  let cost = 0;

  cost += apply(raw, inject.pressure);
  steps.push({
    source: "inject",
    id: inject.id,
    label: inject.title,
    effects: inject.pressure,
  });

  for (const id of levers) {
    const lever = leverById(scenario, id) as Lever;
    if (id in taken) {
      steps.push({
        source: "lever",
        id,
        label: lever.label,
        effects: {},
        repeat: true,
      });
      continue;
    }
    const { effects, late } = effectsAt(lever, hour);
    cost += apply(raw, effects);
    taken[id] = hour;
    steps.push({ source: "lever", id, label: lever.label, effects, late });
  }

  for (const burn of scenario.burns) {
    if (burn.unless.some((lever) => lever in taken)) continue;
    cost += apply(raw, burn.effects);
    steps.push({
      source: "burn",
      id: burn.id,
      label: burn.label,
      effects: burn.effects,
    });
  }

  const after = Object.fromEntries(
    GAUGES.map((gauge) => [gauge, clamp(Math.round(raw[gauge]))]),
  ) as Gauges;
  const delta = Object.fromEntries(
    GAUGES.map((gauge) => [gauge, after[gauge] - state.gauges[gauge]]),
  ) as Gauges;
  const total = round1(state.cost + cost);
  const share = sharePrice(scenario, after, total);
  const slot = state.slot + 1;

  return {
    scenario: scenario.id,
    slot,
    hour,
    gauges: after,
    cost: total,
    share,
    taken,
    outcomes: [
      ...state.outcomes,
      {
        slot: state.slot,
        hour,
        inject: inject.id,
        levers,
        steps,
        delta,
        before: state.gauges,
        after,
        cost: round1(cost),
        share,
      },
    ],
    done: slot >= scenario.slots.length,
  };
}

/** Replays a drill from its Rounds. Throws EngineError if any Round is impossible. */
export function play(scenario: Scenario, rounds: Round[]): DrillState {
  if (rounds.length > scenario.slots.length)
    throw new EngineError("That is more Rounds than the drill has.");
  return rounds.reduce(
    (state, round) => step(scenario, state, round),
    initialState(scenario),
  );
}
