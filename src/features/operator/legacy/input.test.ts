import { describe, expect, it } from "vitest";
import { ACTION_KEYS } from "../domain/actions";
import { domKeyToInput, inputsOf } from "./input";
import { pointOf } from "./terminal";

describe("inputsOf", () => {
  it("types one character at a time, case untouched", () => {
    expect(inputsOf({ type: "type", text: "Ab 1" })).toEqual([
      { kind: "char", char: "A" },
      { kind: "char", char: "b" },
      { kind: "char", char: " " },
      { kind: "char", char: "1" },
    ]);
  });

  it("maps every Action key to a terminal key", () => {
    expect(
      inputsOf({
        type: "key",
        keys: ["Shift+Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
      }),
    ).toEqual(
      ["BackTab", "Up", "Down", "Left", "Right"].map((key) => ({
        kind: "key",
        key,
      })),
    );
    const all = inputsOf({ type: "key", keys: [...ACTION_KEYS].slice(0, 12) });
    expect(all).toHaveLength(12);
    for (const key of ACTION_KEYS) {
      const [input] = inputsOf({ type: "key", keys: [key] });
      expect(input.kind === "key" && input.key.length > 0, key).toBe(true);
    }
  });

  it("turns a click into a cell, or nothing outside the grid", () => {
    const { x, y } = pointOf(23, 79);
    expect(inputsOf({ type: "click", x, y })).toEqual([
      { kind: "click", row: 23, col: 79 },
    ]);
    expect(inputsOf({ type: "click", x: 3, y: 300 })).toEqual([]);
  });

  it("scrolls by a page and waits with nothing", () => {
    expect(inputsOf({ type: "scroll", dy: 240 })).toEqual([
      { kind: "key", key: "PageDown" },
    ]);
    expect(inputsOf({ type: "scroll", dy: -1 })).toEqual([
      { kind: "key", key: "PageUp" },
    ]);
    expect(inputsOf({ type: "wait", ms: 500 })).toEqual([]);
  });
});

describe("domKeyToInput", () => {
  it("passes printable characters through as typed", () => {
    expect(domKeyToInput("a", false)).toEqual({ kind: "char", char: "a" });
    expect(domKeyToInput("A", true)).toEqual({ kind: "char", char: "A" });
    expect(domKeyToInput(" ", false)).toEqual({ kind: "char", char: " " });
    expect(domKeyToInput("-", false)).toEqual({ kind: "char", char: "-" });
  });

  it("maps named keys", () => {
    expect(domKeyToInput("Tab", false)).toEqual({ kind: "key", key: "Tab" });
    expect(domKeyToInput("Tab", true)).toEqual({ kind: "key", key: "BackTab" });
    expect(domKeyToInput("ArrowLeft", false)).toEqual({
      kind: "key",
      key: "Left",
    });
    expect(domKeyToInput("F10", false)).toEqual({ kind: "key", key: "F10" });
    expect(domKeyToInput("Enter", false)).toEqual({
      kind: "key",
      key: "Enter",
    });
  });

  it("ignores what a terminal does not have", () => {
    for (const key of [
      "Shift",
      "Control",
      "Meta",
      "F13",
      "é",
      "Shift+Tab",
      "constructor",
      "Dead",
    ]) {
      expect(domKeyToInput(key, false), key).toBeNull();
    }
  });
});
