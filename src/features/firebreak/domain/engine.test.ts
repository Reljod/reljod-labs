import { describe, expect, it } from "vitest";
import {
  EngineError,
  effectsAt,
  eligibleInjects,
  initialState,
  play,
  type Round,
} from "./engine";
import { scenarioById } from "./scenarios";

const halyard = scenarioById("halyard-air");
if (!halyard) throw new Error("missing scenario");

const option = (inject: string, id: string): Round => ({
  inject,
  choice: { kind: "option", option: id },
  levers: [],
});

describe("play", () => {
  it("starts where the Scenario starts", () => {
    const state = play(halyard, []);
    expect(state.gauges).toEqual(halyard.start);
    expect(state.share).toBe(100);
    expect(state.done).toBe(false);
  });

  it("applies the Inject's pressure, the Levers and what keeps burning", () => {
    const state = play(halyard, [
      option("screens-black", "screens-black/roster"),
    ]);
    const outcome = state.outcomes[0];
    expect(outcome?.steps.map((s) => `${s.source}:${s.id}`)).toEqual([
      "inject:screens-black",
      "lever:manual_roster",
      "burn:silence",
      "burn:authority-blind",
    ]);
    // operations: 82 - 12 (pressure) + 20 (roster) = 90
    expect(state.gauges.operations).toBe(90);
    // customers: 72 - 4 (pressure) - 6 (silence) = 62
    expect(state.gauges.customers).toBe(62);
    expect(state.taken).toEqual({ manual_roster: 0 });
    expect(state.cost).toBe(1.5);
  });

  it("is the same drill however often it is replayed", () => {
    const rounds = [
      option("screens-black", "screens-black/ground"),
      option("courier-memo", "courier-memo/confirm"),
    ];
    expect(play(halyard, rounds)).toEqual(play(halyard, rounds));
  });

  it("refuses an Inject that could not have landed", () => {
    expect(() => play(halyard, [option("backlog", "backlog/hotels")])).toThrow(
      EngineError,
    );
    // duty-hours needs the hand roster first.
    expect(() =>
      play(halyard, [
        option("screens-black", "screens-black/ground"),
        option("terminal-queues", "terminal-queues/care"),
        option("duty-hours", "duty-hours/hall"),
      ]),
    ).toThrow(EngineError);
  });

  it("refuses an Option from another card and an unknown Lever", () => {
    expect(() =>
      play(halyard, [option("screens-black", "backlog/hotels")]),
    ).toThrow(EngineError);
    expect(() =>
      play(halyard, [
        {
          inject: "screens-black",
          choice: { kind: "own", text: "launch the rockets" },
          levers: ["launch_rockets"],
        },
      ]),
    ).toThrow(EngineError);
  });

  it("uses an Option's own Levers, whatever the Round claims", () => {
    const state = play(halyard, [
      {
        ...option("screens-black", "screens-black/roster"),
        levers: ["refunds", "hotels"],
      },
    ]);
    expect(Object.keys(state.taken)).toEqual(["manual_roster"]);
  });

  it("takes the Reader's Levers for the executive's own words", () => {
    const state = play(halyard, [
      {
        inject: "screens-black",
        choice: { kind: "own", text: "Tell everyone and put them in hotels" },
        levers: ["statement", "hotels"],
      },
    ]);
    expect(Object.keys(state.taken).sort()).toEqual(["hotels", "statement"]);
    expect(state.outcomes[0]?.steps.some((s) => s.id === "silence")).toBe(
      false,
    );
  });

  it("does nothing the second time a Lever is pulled", () => {
    const state = play(halyard, [
      option("screens-black", "screens-black/tell"),
      option("terminal-queues", "terminal-queues/camera"),
      option("passports-posted", "passports-posted/report"),
      option("chair-asks", "chair-asks/rebuild"),
      option("decryptor-offer", "decryptor-offer/rebuild"),
    ]);
    const last = state.outcomes[4];
    expect(last?.steps.find((s) => s.id === "ir_firm")?.repeat).toBe(true);
  });

  it("ends after the last Slot and refuses another Round", () => {
    const rounds = [
      option("screens-black", "screens-black/roster"),
      option("courier-memo", "courier-memo/confirm"),
      option("duty-hours", "duty-hours/hall"),
      option("authority-letter", "authority-letter/file"),
      option("decryptor-offer", "decryptor-offer/care"),
      option("back-in-the-air", "back-in-the-air/crews"),
    ];
    const state = play(halyard, rounds);
    expect(state.done).toBe(true);
    expect(eligibleInjects(halyard, state)).toEqual([]);
    expect(() =>
      play(halyard, [
        ...rounds,
        option("back-in-the-air", "back-in-the-air/crews"),
      ]),
    ).toThrow(EngineError);
  });

  it("keeps every Gauge between 0 and 100", () => {
    const state = play(halyard, [
      option("screens-black", "screens-black/tell"),
      option("terminal-queues", "terminal-queues/hold"),
      option("passports-posted", "passports-posted/hold"),
      option("authority-letter", "authority-letter/vendor"),
      option("decryptor-offer", "decryptor-offer/pay"),
    ]);
    for (const value of Object.values(state.gauges)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("effectsAt", () => {
  const statement = halyard.levers.find((l) => l.id === "statement");
  if (!statement) throw new Error("missing lever");

  it("pays in full on time and cuts only the gains when late", () => {
    expect(effectsAt(statement, 3)).toEqual({
      effects: { customers: 10, press: 12 },
      late: false,
    });
    expect(effectsAt(statement, 8)).toEqual({
      effects: { customers: 5, press: 6 },
      late: true,
    });
    const pay = halyard.levers.find((l) => l.id === "pay_ransom");
    if (!pay) throw new Error("missing lever");
    expect(effectsAt(pay, 60).effects).toEqual(pay.effects);
  });
});

describe("eligibleInjects", () => {
  it("offers the Courier's memo only while passengers have not been told", () => {
    const quiet = play(halyard, [
      option("screens-black", "screens-black/roster"),
    ]);
    const told = play(halyard, [option("screens-black", "screens-black/tell")]);
    expect(eligibleInjects(halyard, quiet).map((i) => i.id)).toContain(
      "courier-memo",
    );
    expect(eligibleInjects(halyard, told).map((i) => i.id)).toEqual([
      "terminal-queues",
    ]);
    expect(initialState(halyard).slot).toBe(0);
  });
});
