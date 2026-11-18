import { z } from "zod";
import { GEOMETRY } from "../legacy/types";

/**
 * An Action: one thing done to the Screen with the mouse or the keyboard.
 * The Operator's tools, the MCP tools an outside client calls and a scripted
 * Run all produce these, and all go through the same Guard.
 */

/** The keys `screen_key` may press. Nothing else reaches the browser. */
export const ACTION_KEYS = [
  "Enter",
  "Tab",
  "Shift+Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

export const ACTION_LIMITS = {
  /** Characters one `type` may send. */
  typeChars: 120,
  /** Keys one `key` Action may press in a row. */
  keysPerAction: 12,
  /** The longest `wait`, in ms. */
  waitMs: 3000,
} as const;

export const screenActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    x: z
      .number()
      .int()
      .min(0)
      .max(GEOMETRY.width - 1),
    y: z
      .number()
      .int()
      .min(0)
      .max(GEOMETRY.height - 1),
  }),
  z.object({
    type: z.literal("type"),
    // Printable ASCII only: a terminal field takes nothing else.
    text: z
      .string()
      .min(1)
      .max(ACTION_LIMITS.typeChars)
      .regex(/^[\x20-\x7e]+$/, "Printable characters only."),
  }),
  z.object({
    type: z.literal("key"),
    keys: z.array(z.enum(ACTION_KEYS)).min(1).max(ACTION_LIMITS.keysPerAction),
  }),
  z.object({
    type: z.literal("scroll"),
    /** Positive scrolls down (next page), negative up. */
    dy: z.number().int().min(-2000).max(2000),
  }),
  z.object({
    type: z.literal("wait"),
    ms: z.number().int().min(100).max(ACTION_LIMITS.waitMs),
  }),
]);

export type ScreenAction = z.infer<typeof screenActionSchema>;

/** A short label for the timeline and the key-press chips: `type "MRDU4821130"`, `key F10`. */
export function actionLabel(action: ScreenAction): string {
  switch (action.type) {
    case "click":
      return `click ${action.x},${action.y}`;
    case "type":
      return `type "${action.text}"`;
    case "key":
      return `key ${action.keys.join(" ")}`;
    case "scroll":
      return `scroll ${action.dy > 0 ? "down" : "up"}`;
    case "wait":
      return `wait ${action.ms} ms`;
  }
}

/** One turn of a scripted Run (the stubbed Operator, and the answer key of a sample Task). */
export type ScriptTurn = {
  /** What the Operator means to do, one line. */
  intent: string;
  actions: ScreenAction[];
};
