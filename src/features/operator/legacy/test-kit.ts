import type { ScreenAction } from "../domain/actions";
import { inputsOf } from "./input";
import { boot, render, step } from "./machine";
import { screenText } from "./terminal";
import type {
  Fixture,
  LegacyInput,
  LegacyKey,
  LegacyState,
  Screen,
} from "./types";

/** Test helpers only: a terminal session with its own clock. */

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** `"<F10>"` is a key; any other string is typed character by character. */
function inputsFor(item: string): LegacyInput[] {
  const key = /^<(\w+)>$/.exec(item);
  if (key) return [{ kind: "key", key: key[1] as LegacyKey }];
  return [...item].map((char) => ({ kind: "char", char }));
}

export const START = 1_800_000_000_000;
export const TICK = 400;

export class Session {
  state: LegacyState;
  now = START;

  constructor(fixture: Fixture) {
    this.state = boot(fixture, this.now);
  }

  send(input: LegacyInput): this {
    this.now += TICK;
    // Every step runs on a frozen state: a mutation would throw.
    this.state = step(deepFreeze(this.state), input, this.now);
    return this;
  }

  /** Keys and text, in order: `feed("OPR7", "<Tab>", "MERIDIA1", "<Enter>")`. */
  feed(...items: string[]): this {
    for (const item of items) for (const i of inputsFor(item)) this.send(i);
    return this;
  }

  act(...actions: ScreenAction[]): this {
    for (const a of actions) for (const i of inputsOf(a)) this.send(i);
    return this;
  }

  signOn(): this {
    return this.feed("OPR7", "<Tab>", "MERIDIA1", "<Enter>");
  }

  idle(ms: number): this {
    this.now += ms;
    return this;
  }

  get screen(): Screen {
    return render(this.state, this.now);
  }

  get text(): string[] {
    return screenText(this.screen);
  }

  /** The message line, trimmed. */
  get message(): string {
    return this.text[22].trim();
  }

  /** Where a piece of text is on the Screen. */
  find(needle: string): { row: number; col: number } {
    const rows = this.text;
    for (let row = 0; row < rows.length; row += 1) {
      const col = rows[row].indexOf(needle);
      if (col >= 0) return { row, col };
    }
    throw new Error(`"${needle}" is not on the Screen`);
  }
}
