/**
 * The App's data colours. The hex values repeat `domain/palette.ts` (the App
 * bundle imports only types from the domain); `colors.test.ts` holds the two
 * to each other.
 */

/** Categorical slots in fixed order. Never cycled: a ninth series is drawn in the "Other" grey. */
export const CATEGORICAL = {
  light: [
    "#2a78d6",
    "#eb6834",
    "#1baf7a",
    "#eda100",
    "#e87ba4",
    "#008300",
    "#6250d6",
    "#e34948",
  ],
  dark: [
    "#3987e5",
    "#d95926",
    "#199e70",
    "#c98500",
    "#d55181",
    "#0ca30c",
    "#9085e9",
    "#e66767",
  ],
} as const;

/** One hue, light to dark, for magnitude. */
export const SEQUENTIAL_RAMP = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
] as const;

/** De-emphasis: series past the eighth, and regions with no value. */
export const OTHER = { light: "#b9b6ad", dark: "#5c667d" } as const;

export const SLOTS = 8;

export type Theme = "light" | "dark";

/**
 * Colour follows the entity: a series that already has a slot keeps it, a
 * new one takes the lowest free slot, and a series past the eighth gets -1
 * ("Other"). `previous` is what the View showed before a Control changed.
 */
export function assignSlots(
  names: readonly string[],
  previous: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const slots: Record<string, number> = {};
  const taken = new Set<number>();
  for (const name of names) {
    const kept = previous[name];
    if (kept !== undefined && kept >= 0 && kept < SLOTS && !taken.has(kept)) {
      slots[name] = kept;
      taken.add(kept);
    }
  }
  let next = 0;
  for (const name of names) {
    if (name in slots) continue;
    while (taken.has(next)) next++;
    if (next < SLOTS) {
      slots[name] = next;
      taken.add(next);
    } else slots[name] = -1;
  }
  return slots;
}

/** The colour of a slot: the spec's own colours when it gives them, else the palette. */
export function slotColor(
  slot: number,
  theme: Theme,
  custom?: readonly string[],
) {
  if (slot < 0) return OTHER[theme];
  return custom?.[slot] ?? CATEGORICAL[theme][slot] ?? OTHER[theme];
}

/**
 * The ramp for a surface, least to most. On a dark surface the anchor flips:
 * "near zero" recedes toward the surface in both themes.
 */
export function sequentialRamp(theme: Theme): readonly string[] {
  return theme === "dark" ? [...SEQUENTIAL_RAMP].reverse() : SEQUENTIAL_RAMP;
}

function luminance(hex: string) {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** White or near-black, whichever reads on a fill. The same two in both themes. */
export function inkOn(hex: string) {
  return luminance(hex) > 0.36 ? "#0b1220" : "#ffffff";
}
