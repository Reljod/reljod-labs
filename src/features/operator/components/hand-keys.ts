/**
 * "Take the keyboard": what a key press or a click in the browser is, as an
 * Action on the Screen. Pure, so the mapping is tested without a DOM.
 */
import { ACTION_KEYS, type ActionKey, type ScreenAction } from "../domain/actions";
import { GEOMETRY } from "../legacy/types";

export type KeyPress = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

const PRINTABLE = /^[\x20-\x7e]$/;
const NAMED = new Set<string>(ACTION_KEYS);

/**
 * The Action a key press is, or null when it is the browser's own (a
 * shortcut with Ctrl, Cmd or Alt, or a key HARBOURMASTER does not take).
 */
export function actionOfKey(press: KeyPress): ScreenAction | null {
  if (press.ctrlKey || press.metaKey || press.altKey) return null;
  const { key } = press;
  if (PRINTABLE.test(key)) return { type: "type", text: key };
  if (key === "Tab")
    return { type: "key", keys: [press.shiftKey ? "Shift+Tab" : "Tab"] };
  if (NAMED.has(key)) return { type: "key", keys: [key as ActionKey] };
  return null;
}

/** Two Escapes this close together let go of the terminal. */
export const RELEASE_MS = 900;

/** Whether this Escape is the second of two, which releases focus instead of being keyed. */
export function releasesFocus(
  press: KeyPress,
  lastEscapeAt: number | null,
  now: number,
) {
  return (
    press.key === "Escape" &&
    lastEscapeAt !== null &&
    now - lastEscapeAt <= RELEASE_MS
  );
}

/**
 * A click on the scaled terminal, as a click Action in Screen pixels. `box`
 * is the terminal's rectangle on the page (it shows the whole Screen).
 */
export function clickAction(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
): ScreenAction | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const pixel = (offset: number, size: number, native: number) =>
    Math.min(native - 1, Math.max(0, Math.floor((offset / size) * native)));
  return {
    type: "click",
    x: pixel(clientX - box.left, box.width, GEOMETRY.width),
    y: pixel(clientY - box.top, box.height, GEOMETRY.height),
  };
}
