import type { ActionKey, ScreenAction } from "../domain/actions";
import { cellAt } from "./terminal";
import type { LegacyInput, LegacyKey } from "./types";

/** From an Action, or a browser key, to what the terminal sends the host. */

const LEGACY_KEY: Record<ActionKey, LegacyKey> = {
  Enter: "Enter",
  Tab: "Tab",
  "Shift+Tab": "BackTab",
  Backspace: "Backspace",
  Delete: "Delete",
  Escape: "Escape",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
};

/** The atomic inputs one Action sends, in order. */
export function inputsOf(action: ScreenAction): LegacyInput[] {
  switch (action.type) {
    case "type":
      return [...action.text].map((char) => ({ kind: "char", char }));
    case "key":
      return action.keys.map((key) => ({ kind: "key", key: LEGACY_KEY[key] }));
    case "click": {
      const cell = cellAt(action.x, action.y);
      return cell ? [{ kind: "click", ...cell }] : [];
    }
    case "scroll":
      return [{ kind: "key", key: action.dy > 0 ? "PageDown" : "PageUp" }];
    case "wait":
      return [];
  }
}

/**
 * A browser `KeyboardEvent.key` as an input, or null for a key the terminal
 * does not have. Upper-casing is the machine's job.
 */
export function domKeyToInput(
  key: string,
  shiftKey: boolean,
): LegacyInput | null {
  if (key === "Tab") return { kind: "key", key: shiftKey ? "BackTab" : "Tab" };
  if (key.length === 1) {
    return key >= " " && key <= "~" ? { kind: "char", char: key } : null;
  }
  // "Shift+Tab" is an Action key, never a browser key.
  if (key !== "Shift+Tab" && Object.hasOwn(LEGACY_KEY, key)) {
    return { kind: "key", key: LEGACY_KEY[key as ActionKey] };
  }
  return null;
}
