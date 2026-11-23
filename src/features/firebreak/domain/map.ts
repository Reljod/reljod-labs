/**
 * The Fire map's geometry. A hexagon of hexes, radius 4, with the company in
 * the middle and six wedges around it, one per Stakeholder. A wedge burns
 * from the outside in as its Gauge falls, so a crisis that is going badly
 * visibly creeps towards the centre. Pure: the browser draws it.
 */
import { GAUGES, type GaugeId } from "./scenario";

export const MAP_RADIUS = 4;
/** Hex size (centre to corner) in map units. */
export const HEX = 10;

/** Clockwise from the top right, the wedge each Gauge holds. */
export const WEDGES: GaugeId[] = [
  "press",
  "regulator",
  "board",
  "operations",
  "staff",
  "customers",
];

export type Hex = {
  q: number;
  r: number;
  x: number;
  y: number;
  /** Rings out from the centre: 0 is the company. */
  ring: number;
  /** The wedge's Gauge, or null for the centre. */
  gauge: GaugeId | null;
  /** Burn order within the wedge: 0 burns first. */
  order: number;
};

const SQRT3 = Math.sqrt(3);

/** A small deterministic jitter so the burn front is ragged, not a ruler line. */
function jitter(q: number, r: number): number {
  const seed = Math.sin(q * 12.9898 + r * 78.233) * 43758.5453;
  return seed - Math.floor(seed);
}

function build(): Hex[] {
  const cells: Omit<Hex, "order">[] = [];
  for (let q = -MAP_RADIUS; q <= MAP_RADIUS; q++) {
    for (let r = -MAP_RADIUS; r <= MAP_RADIUS; r++) {
      const s = -q - r;
      const ring = (Math.abs(q) + Math.abs(r) + Math.abs(s)) / 2;
      if (ring > MAP_RADIUS) continue;
      const x = HEX * SQRT3 * (q + r / 2);
      const y = HEX * 1.5 * r;
      let gauge: GaugeId | null = null;
      if (ring > 0) {
        // Wedges centred on 0°, 60°, …; nudged by a degree so a hex on a
        // boundary always falls the same way.
        const angle = ((Math.atan2(y, x) * 180) / Math.PI + 360 + 30 + 1) % 360;
        gauge = WEDGES[Math.floor(angle / 60) % 6] ?? null;
      }
      cells.push({ q, r, x, y, ring, gauge });
    }
  }
  const hexes: Hex[] = [];
  for (const gauge of [null, ...GAUGES]) {
    const wedge = cells
      .filter((cell) => cell.gauge === gauge)
      .sort(
        (a, b) =>
          b.ring + jitter(b.q, b.r) * 0.9 - (a.ring + jitter(a.q, a.r) * 0.9),
      );
    for (const [order, cell] of wedge.entries()) hexes.push({ ...cell, order });
  }
  return hexes;
}

export const HEXES: Hex[] = build();

export const wedgeSize = (gauge: GaugeId) =>
  HEXES.filter((hex) => hex.gauge === gauge).length;

/** A pointy-top hexagon's outline around (0, 0), a little inset so the grid shows. */
export function hexPoints(size = HEX - 0.9): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index - 30);
    return `${(size * Math.cos(angle)).toFixed(2)},${(size * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

/** How many of a wedge's hexes are alight at a Gauge value. Above 88 none, at 18 or below all. */
export function alight(value: number, size: number): number {
  const share = Math.max(0, Math.min(1, (88 - value) / 70));
  return Math.round(share * size);
}

export type Burn = "calm" | "warm" | "flame" | "char";

/**
 * What one hex looks like: the newest two alight are flames, older ones are
 * charred, and the next one in line is warm.
 */
export function burnOf(order: number, lit: number): Burn {
  if (order < lit - 2) return "char";
  if (order < lit) return "flame";
  if (order === lit) return "warm";
  return "calm";
}

/** Where a wedge's label sits: out past the rim on the wedge's centre line. */
export function seatOf(gauge: GaugeId, distance = HEX * 1.5 * MAP_RADIUS + 26) {
  const index = WEDGES.indexOf(gauge);
  const angle = (Math.PI / 180) * (index * 60);
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    angle: index * 60,
  };
}
