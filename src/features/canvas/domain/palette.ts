/**
 * Colour maths for the chart Rules: OKLab distance between series colours as
 * seen with protanopia and deuteranopia (Machado, Oliveira & Fernandes 2009,
 * severity 1.0). Pure; the App draws with the palette, the check measures it.
 */

/** Categorical slots in fixed order, light and dark surface. Never cycled: a ninth series folds into "Other". */
export const PALETTE = {
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

/** One hue, light to dark, for magnitude (heatmap, map). */
export const SEQUENTIAL = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
] as const;

const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

type Rgb = [number, number, number];

const toLinear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

function linear(hex: string): Rgb {
  const text = hex.replace(/^#/, "");
  return [0, 2, 4].map((at) =>
    toLinear(Number.parseInt(text.slice(at, at + 2), 16) / 255),
  ) as Rgb;
}

function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function simulated(rgb: Rgb, kind: keyof typeof MACHADO): Rgb {
  const matrix = MACHADO[kind];
  return matrix.map((row) =>
    Math.max(
      0,
      Math.min(1, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]),
    ),
  ) as Rgb;
}

const distance = (a: Rgb, b: Rgb) =>
  100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function isHex(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** OKLab distance (×100) between two colours as the worse of protan and deutan sees them. */
export function cvdDistance(a: string, b: string) {
  const [first, second] = [linear(a), linear(b)];
  return Math.min(
    distance(
      oklab(simulated(first, "protan")),
      oklab(simulated(second, "protan")),
    ),
    distance(
      oklab(simulated(first, "deutan")),
      oklab(simulated(second, "deutan")),
    ),
  );
}

/** The closest neighbouring pair of a palette, as colour-blind readers see it. */
export function worstAdjacentPair(colors: readonly string[]) {
  let worst: { a: string; b: string; deltaE: number } | null = null;
  for (let index = 0; index + 1 < colors.length; index++) {
    const deltaE = cvdDistance(colors[index], colors[index + 1]);
    if (!worst || deltaE < worst.deltaE)
      worst = { a: colors[index], b: colors[index + 1], deltaE };
  }
  return worst;
}
