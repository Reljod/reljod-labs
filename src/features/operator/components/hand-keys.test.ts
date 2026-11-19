import { describe, expect, it } from "vitest";
import { screenActionSchema } from "../domain/actions";
import {
  actionOfKey,
  clickAction,
  RELEASE_MS,
  releasesFocus,
} from "./hand-keys";

describe("actionOfKey", () => {
  it("types a printable character", () => {
    expect(actionOfKey({ key: "a" })).toEqual({ type: "type", text: "a" });
    expect(actionOfKey({ key: "M", shiftKey: true })).toEqual({
      type: "type",
      text: "M",
    });
    expect(actionOfKey({ key: " " })).toEqual({ type: "type", text: " " });
  });

  it("presses the named keys, with Shift+Tab as its own key", () => {
    expect(actionOfKey({ key: "Enter" })).toEqual({
      type: "key",
      keys: ["Enter"],
    });
    expect(actionOfKey({ key: "F10" })).toEqual({ type: "key", keys: ["F10"] });
    expect(actionOfKey({ key: "Tab" })).toEqual({ type: "key", keys: ["Tab"] });
    expect(actionOfKey({ key: "Tab", shiftKey: true })).toEqual({
      type: "key",
      keys: ["Shift+Tab"],
    });
    expect(actionOfKey({ key: "ArrowLeft" })).toEqual({
      type: "key",
      keys: ["ArrowLeft"],
    });
  });

  it("leaves the browser's shortcuts and unknown keys alone", () => {
    expect(actionOfKey({ key: "r", ctrlKey: true })).toBeNull();
    expect(actionOfKey({ key: "l", metaKey: true })).toBeNull();
    expect(actionOfKey({ key: "Shift" })).toBeNull();
    expect(actionOfKey({ key: "é" })).toBeNull();
    expect(actionOfKey({ key: "F13" })).toBeNull();
  });

  it("only makes Actions the contract accepts", () => {
    for (const key of ["a", "~", "Enter", "Tab", "F1", "PageDown", "Delete"]) {
      const action = actionOfKey({ key });
      expect(screenActionSchema.safeParse(action).success).toBe(true);
    }
  });
});

describe("releasesFocus", () => {
  it("lets go on the second Escape only", () => {
    expect(releasesFocus({ key: "Escape" }, null, 1000)).toBe(false);
    expect(releasesFocus({ key: "Escape" }, 1000, 1400)).toBe(true);
    expect(releasesFocus({ key: "Escape" }, 1000, 1001 + RELEASE_MS)).toBe(
      false,
    );
    expect(releasesFocus({ key: "Enter" }, 1000, 1100)).toBe(false);
  });
});

describe("clickAction", () => {
  const box = { left: 100, top: 50, width: 512, height: 320 };

  it("turns page pixels into Screen pixels", () => {
    expect(clickAction(100, 50, box)).toEqual({ type: "click", x: 0, y: 0 });
    expect(clickAction(356, 210, box)).toEqual({
      type: "click",
      x: 512,
      y: 320,
    });
  });

  it("stays on the Screen and refuses an unmeasured box", () => {
    expect(clickAction(9999, 9999, box)).toEqual({
      type: "click",
      x: 1023,
      y: 639,
    });
    expect(clickAction(0, 0, box)).toEqual({ type: "click", x: 0, y: 0 });
    expect(clickAction(1, 1, { ...box, width: 0 })).toBeNull();
    expect(
      screenActionSchema.safeParse(clickAction(9999, 9999, box)).success,
    ).toBe(true);
  });
});
