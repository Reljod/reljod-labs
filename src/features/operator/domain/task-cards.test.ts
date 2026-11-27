import { describe, expect, it } from "vitest";
import { inputsOf } from "../legacy/input";
import { boot, step } from "../legacy/machine";
import type { LegacyState } from "../legacy/types";
import type { ScreenAction } from "./actions";
import { OWN_OPERATOR, OWN_SIGN_ON, ownFixture, taskCards } from "./task-cards";

describe("taskCards", () => {
  const cards = taskCards();

  // The cards go to the browser: the answer key stays on the server.
  it("carries no Script and no Fixture", () => {
    for (const card of cards) {
      expect(card).not.toHaveProperty("script");
      expect(card).not.toHaveProperty("fixture");
      expect(JSON.stringify(card)).not.toContain('"books"');
    }
  });
});

describe("ownFixture", () => {
  const act = (state: LegacyState, now: number, action: ScreenAction) => {
    let next = state;
    let at = now;
    for (const input of inputsOf(action)) {
      at += 400;
      next = step(next, input, at);
    }
    return { state: next, now: at };
  };

  it("boots on the sign-on Screen and signs on as OWN_OPERATOR", () => {
    const fixture = ownFixture();
    expect(fixture.operator).toEqual(OWN_OPERATOR);
    expect(fixture.locks).toEqual([]);

    let now = 1_800_000_000_000;
    let state = boot(fixture, now);
    expect(state.screen).toBe("HMS000");
    expect(state.signedOn).toBe(false);

    for (const action of [
      { type: "type", text: OWN_OPERATOR.id },
      { type: "key", keys: ["Tab"] },
      { type: "type", text: OWN_OPERATOR.password },
      { type: "key", keys: ["Enter"] },
    ] satisfies ScreenAction[])
      ({ state, now } = act(state, now, action));

    expect(state.signedOn).toBe(true);
    expect(state.screen).toBe("HMM100");
  });

  it("a wrong password does not sign on", () => {
    let now = 1_800_000_000_000;
    let state = boot(ownFixture(), now);
    for (const action of [
      { type: "type", text: OWN_OPERATOR.id },
      { type: "key", keys: ["Tab"] },
      { type: "type", text: "WRONG" },
      { type: "key", keys: ["Enter"] },
    ] satisfies ScreenAction[])
      ({ state, now } = act(state, now, action));
    expect(state.signedOn).toBe(false);
    expect(state.screen).toBe("HMS000");
  });

  it("gives fresh Books every time", () => {
    const a = ownFixture();
    a.books.vessels.pop();
    expect(ownFixture().books.vessels.length).toBe(a.books.vessels.length + 1);
  });

  it("OWN_SIGN_ON names the sign on", () => {
    expect(OWN_SIGN_ON).toContain(OWN_OPERATOR.id);
    expect(OWN_SIGN_ON).toContain(OWN_OPERATOR.password);
  });
});
