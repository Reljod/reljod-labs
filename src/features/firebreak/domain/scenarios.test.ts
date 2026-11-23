import { describe, expect, it } from "vitest";
import {
  type DrillState,
  eligibleInjects,
  initialState,
  mean,
  type Round,
  step,
} from "./engine";
import { scorecard } from "./review";
import { checkRules } from "./rules";
import { GAUGES, type Inject, type Scenario } from "./scenario";
import { SCENARIOS } from "./scenarios";

/** Plays a drill to the end, taking the first eligible Inject and the Option `pick` chooses. */
function playThrough(
  scenario: Scenario,
  pick: (inject: Inject, slot: number) => string,
): DrillState {
  let state = initialState(scenario);
  while (!state.done) {
    const inject = eligibleInjects(scenario, state)[0];
    if (!inject) throw new Error(`No Inject for slot ${state.slot}`);
    const round: Round = {
      inject: inject.id,
      choice: { kind: "option", option: pick(inject, state.slot) },
      levers: [],
    };
    state = step(scenario, state, round);
  }
  return state;
}

describe.each(SCENARIOS)("Scenario $id", (scenario) => {
  const leverIds = new Set(scenario.levers.map((lever) => lever.id));

  it("has one Stakeholder per Gauge", () => {
    expect(scenario.stakeholders.map((s) => s.gauge).sort()).toEqual(
      [...GAUGES].sort(),
    );
  });

  it("has unique ids", () => {
    const injects = scenario.injects.map((inject) => inject.id);
    const options = scenario.injects.flatMap((inject) =>
      inject.options.map((option) => option.id),
    );
    expect(new Set(injects).size).toBe(injects.length);
    expect(new Set(options).size).toBe(options.length);
    expect(leverIds.size).toBe(scenario.levers.length);
  });

  it("names only Levers that exist", () => {
    const named = [
      ...scenario.injects.flatMap((inject) => [
        ...inject.options.flatMap((option) => option.levers),
        ...(inject.when?.taken ?? []),
        ...(inject.when?.notTaken ?? []),
      ]),
      ...scenario.burns.flatMap((burn) => burn.unless),
      ...scenario.rules.flatMap((rule) =>
        rule.kind === "by"
          ? rule.anyOf
          : rule.kind === "before"
            ? [rule.lever, ...rule.first]
            : [rule.lever],
      ),
      ...scenario.statement.promises.map((promise) => promise.lever),
    ];
    for (const id of named) expect(leverIds, id).toContain(id);
  });

  it("always has an Inject that can land in every Slot", () => {
    scenario.slots.forEach((_, slot) => {
      const here = scenario.injects.filter((inject) => inject.slot === slot);
      const open = here.some((inject) => !inject.when);
      // Or two Injects whose Conditions are each other's opposite.
      const paired = here.some(
        (a) =>
          a.when?.taken?.length === 1 &&
          !a.when.notTaken &&
          !a.when.below &&
          here.some(
            (b) =>
              b.when?.notTaken?.length === 1 &&
              !b.when.taken &&
              !b.when.below &&
              b.when.notTaken[0] === a.when?.taken?.[0],
          ),
      );
      expect(open || paired, `slot ${slot}`).toBe(true);
    });
  });

  it("offers three Options of at most two Levers on every Inject", () => {
    for (const inject of scenario.injects) {
      expect(inject.options).toHaveLength(3);
      for (const option of inject.options)
        expect(option.levers.length).toBeLessThanOrEqual(2);
    }
  });

  it("plays its recorded drill exactly as written", () => {
    let used = 0;
    const state = playThrough(scenario, (inject, slot) => {
      const wanted = scenario.recorded[slot];
      const option = inject.options.find((item) => item.id === wanted);
      if (option) used++;
      return option?.id ?? (inject.options[0]?.id as string);
    });
    expect(used).toBe(scenario.slots.length);
    expect(state.done).toBe(true);
  });

  it("rewards the careful path and punishes the reckless one", () => {
    const careful = playThrough(scenario, (inject, slot) => {
      const wanted = scenario.recorded[slot];
      return (
        inject.options.find((item) => item.id === wanted)?.id ??
        (inject.options[0]?.id as string)
      );
    });
    const reckless = playThrough(
      scenario,
      (inject) => inject.options[inject.options.length - 1]?.id as string,
    );
    const good = scorecard(scenario, careful);
    const bad = scorecard(scenario, reckless);
    expect(["A", "B"]).toContain(good.grade);
    expect(["D", "E"]).toContain(bad.grade);
    expect(mean(careful.gauges)).toBeGreaterThan(mean(reckless.gauges) + 15);
    expect(
      checkRules(scenario, reckless).filter((f) => f.status !== "met").length,
    ).toBeGreaterThanOrEqual(3);
  });
});
