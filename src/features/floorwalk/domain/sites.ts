/**
 * The Sample Sites: two premises in the fictional Republic of Meridia, each
 * with a Floor plan in metres. The same data builds the 3D walk that becomes
 * the Sample's footage (`fixtures/floorwalk/scene.html`) and the plan the
 * page draws, so the plan always matches what the camera saw.
 *
 * Plan coordinates: x grows east, y grows south, both in metres from the
 * north-west corner.
 */
import type { SiteKind } from "./rules";

export type Rect = readonly [x: number, y: number, w: number, h: number];

export type Zone = { id: string; label: string; rect: Rect };

export type Rack = {
  id: string;
  rect: Rect;
  /** Shelf levels, counting the floor. */
  levels: number;
  /** Width of one bay along the rack's long side. */
  bay: number;
  style: "pallet" | "gondola";
};

export type Wall = "n" | "s" | "e" | "w";

export type Door = {
  id: string;
  kind: "exit" | "cold" | "dock";
  /** Centre of the door on the wall. */
  x: number;
  y: number;
  /** Which side of the walked floor the door is on; it faces back into the floor. */
  wall: Wall;
  width: number;
  /** 0 is shut, 1 is wide open. */
  open: number;
  label?: string;
};

export type Prop =
  | {
      id: string;
      kind: "pallet-stack";
      x: number;
      y: number;
      rot?: number;
      tall?: number;
    }
  | { id: string; kind: "crates"; x: number; y: number; rot?: number }
  | {
      id: string;
      kind: "puddle";
      x: number;
      y: number;
      r: number;
      tint?: "water" | "sauce";
    }
  | { id: string; kind: "wet-sign"; x: number; y: number; rot?: number }
  | { id: string; kind: "broken-jar"; x: number; y: number }
  | { id: string; kind: "carton"; x: number; y: number; rot?: number }
  | { id: string; kind: "extinguisher"; x: number; y: number; face: Wall }
  | { id: string; kind: "pillar"; x: number; y: number }
  | { id: string; kind: "door-wedge"; door: string }
  | {
      id: string;
      kind: "worker";
      /** Where the worker walks, and when. */
      from: readonly [number, number];
      to: readonly [number, number];
      t0: number;
      t1: number;
      vest: boolean;
    }
  | { id: string; kind: "forklift"; x: number; y: number; rot: number }
  | { id: string; kind: "lean"; rack: string; bay: number; level: number }
  | {
      id: string;
      kind: "gap";
      rack: string;
      side: "e" | "w";
      bay: number;
      level: number;
    }
  | {
      id: string;
      kind: "no-labels";
      rack: string;
      side: "e" | "w";
      bay: number;
      level: number;
    }
  | { id: string; kind: "produce"; rect: Rect }
  | {
      id: string;
      kind: "fridges";
      rect: Rect;
      face: Wall;
      doors: number;
      ajar?: number;
    }
  | { id: string; kind: "checkout"; x: number; y: number };

/** A point on the camera's route: where it is at `t` seconds. */
export type Waypoint = readonly [x: number, y: number, t: number];

/** A glance: between `from` and `to` seconds the camera turns toward a point. */
export type Glance = {
  from: number;
  to: number;
  x: number;
  y: number;
  /** Height looked at, metres. */
  z: number;
};

/**
 * A problem planted in the Sample on purpose, or a decoy that looks like one
 * and is not. The answer key a Walk of the Sample is measured against.
 */
export type Planted = {
  id: string;
  rule: string;
  /** The props that show it; their screen boxes come from the render. */
  props: readonly string[];
  /** A decoy: it looks like a problem, but the Rule is kept. */
  decoy?: boolean;
  note: string;
};

export type Site = {
  slug: string;
  name: string;
  kind: SiteKind;
  /** One line under the name. */
  place: string;
  /** What the walker is looking for, for the Sample card. */
  blurb: string;
  size: readonly [w: number, h: number];
  /** Floor and wall colours of the 3D walk. */
  palette: { floor: string; wall: string; rack: string; accent: string };
  zones: readonly Zone[];
  /** Walled rooms inside the floor (a chiller); a door on an edge cuts it. */
  rooms: readonly Rect[];
  racks: readonly Rack[];
  doors: readonly Door[];
  props: readonly Prop[];
  route: readonly Waypoint[];
  glances: readonly Glance[];
  planted: readonly Planted[];
  /** The body camera's clock at second 0, burned into the footage. */
  clock: string;
  camera: string;
};

export const SITES: readonly Site[] = [
  {
    slug: "cold-store",
    name: "Saltmarsh Cold Store",
    kind: "warehouse",
    place: "Port of Meridia, Dock 4 · a 3PL chilled warehouse",
    blurb: "Pallet racking, a chiller, a forklift and the morning shift.",
    size: [30, 20],
    palette: {
      floor: "#8f9396",
      wall: "#c9cfd3",
      rack: "#2f5d9e",
      accent: "#f2a516",
    },
    clock: "2026-11-21T06:42:10",
    camera: "SALTMARSH · BODYCAM 02",
    zones: [
      { id: "receiving", label: "Receiving", rect: [0, 15, 12, 5] },
      { id: "aisle-1", label: "Aisle 1", rect: [4.2, 4, 3.8, 11] },
      { id: "aisle-2", label: "Aisle 2", rect: [9.2, 4, 3.8, 11] },
      { id: "cross-aisle", label: "Cross aisle", rect: [0, 0, 20, 4] },
      { id: "aisle-3", label: "Aisle 3", rect: [14.2, 4, 5.8, 11] },
      { id: "chiller-c", label: "Chiller C", rect: [20, 1, 10, 13] },
      { id: "dispatch", label: "Dispatch", rect: [12, 15, 18, 5] },
    ],
    rooms: [[20, 1, 10, 13]],
    racks: [
      { id: "A", rect: [3, 4, 1.2, 11], levels: 4, bay: 2.75, style: "pallet" },
      { id: "B", rect: [8, 4, 1.2, 11], levels: 4, bay: 2.75, style: "pallet" },
      {
        id: "C",
        rect: [13, 4, 1.2, 11],
        levels: 4,
        bay: 2.75,
        style: "pallet",
      },
    ],
    doors: [
      {
        id: "exit-north",
        kind: "exit",
        x: 6.1,
        y: 0,
        wall: "n",
        width: 1.2,
        open: 0,
        label: "FIRE EXIT",
      },
      {
        id: "chiller-door",
        kind: "cold",
        x: 20,
        y: 6,
        wall: "e",
        width: 2.4,
        open: 0.85,
        label: "CHILLER C  +2°C",
      },
      {
        id: "dock-1",
        kind: "dock",
        x: 4,
        y: 20,
        wall: "s",
        width: 3.2,
        open: 0,
      },
      {
        id: "dock-2",
        kind: "dock",
        x: 22,
        y: 20,
        wall: "s",
        width: 3.2,
        open: 0,
      },
      {
        id: "exit-east",
        kind: "exit",
        x: 30,
        y: 17.5,
        wall: "e",
        width: 1.2,
        open: 0,
        label: "FIRE EXIT",
      },
    ],
    props: [
      { id: "spill-aisle-1", kind: "puddle", x: 6.0, y: 10.2, r: 0.75 },
      { id: "lean-b", kind: "lean", rack: "B", bay: 0, level: 3 },
      {
        id: "pallet-exit",
        kind: "pallet-stack",
        x: 6.15,
        y: 0.85,
        rot: 0.08,
        tall: 1.5,
      },
      { id: "chiller-wedge", kind: "door-wedge", door: "chiller-door" },
      { id: "spill-aisle-3", kind: "puddle", x: 16.4, y: 8.4, r: 0.6 },
      { id: "sign-aisle-3", kind: "wet-sign", x: 16.0, y: 7.6, rot: 0.5 },
      { id: "pillar-3", kind: "pillar", x: 19.6, y: 13 },
      {
        id: "extinguisher-3",
        kind: "extinguisher",
        x: 19.25,
        y: 13,
        face: "w",
      },
      { id: "crates-3", kind: "crates", x: 18.55, y: 13.05, rot: 0.1 },
      {
        id: "worker-no-vest",
        kind: "worker",
        from: [19.2, 10.6],
        to: [14.6, 10.9],
        t0: 22.5,
        t1: 27.5,
        vest: false,
      },
      {
        id: "worker-vest",
        kind: "worker",
        from: [24, 17.2],
        to: [21.5, 17.6],
        t0: 28,
        t1: 34,
        vest: true,
      },
      {
        id: "forklift-dispatch",
        kind: "forklift",
        x: 23.5,
        y: 16.2,
        rot: -1.2,
      },
      {
        id: "pallet-dispatch",
        kind: "pallet-stack",
        x: 26.5,
        y: 18.3,
        rot: 0,
        tall: 1.1,
      },
    ],
    route: [
      [6.1, 18.6, 0],
      [6.1, 13.5, 4.2],
      [6.1, 6.0, 10.4],
      [6.1, 3.0, 13.4],
      [7.6, 2.4, 15.2],
      [14.5, 2.4, 19.4],
      [17.0, 3.2, 21.2],
      [17.0, 9.0, 25.4],
      [17.0, 14.5, 29.6],
      [18.6, 16.6, 31.8],
      [20.5, 17.0, 34],
    ],
    glances: [
      { from: 4.6, to: 8.2, x: 8.0, y: 4.6, z: 3.0 },
      { from: 15.6, to: 20.4, x: 20, y: 6, z: 1.4 },
      { from: 25.8, to: 29.4, x: 19.4, y: 13, z: 0.9 },
      { from: 31.2, to: 34, x: 23.5, y: 16.6, z: 1.2 },
    ],
    planted: [
      {
        id: "p-exit",
        rule: "exits-clear",
        props: ["pallet-exit"],
        note: "A pallet stands in front of the north fire exit.",
      },
      {
        id: "p-spill",
        rule: "spill-marked",
        props: ["spill-aisle-1"],
        note: "A spill in Aisle 1 has no sign.",
      },
      {
        id: "p-lean",
        rule: "stock-square",
        props: ["lean-b"],
        note: "Cartons lean out over the top beam of rack B.",
      },
      {
        id: "p-chiller",
        rule: "cold-door-shut",
        props: ["chiller-door", "chiller-wedge"],
        note: "Chiller C's door is wedged open with a carton.",
      },
      {
        id: "p-vest",
        rule: "hi-vis-worn",
        props: ["worker-no-vest"],
        note: "A worker crosses Aisle 3 without a vest.",
      },
      {
        id: "p-extinguisher",
        rule: "extinguisher-reachable",
        props: ["extinguisher-3", "crates-3"],
        note: "Crates are stacked in front of the extinguisher on the pillar.",
      },
      {
        id: "d-spill",
        rule: "spill-marked",
        props: ["spill-aisle-3", "sign-aisle-3"],
        decoy: true,
        note: "A spill in Aisle 3, but it has its wet-floor sign.",
      },
      {
        id: "d-vest",
        rule: "hi-vis-worn",
        props: ["worker-vest"],
        decoy: true,
        note: "A worker at Dispatch, wearing a vest.",
      },
    ],
  },
  {
    slug: "grocer",
    name: "Harbour Street Grocer",
    kind: "retail",
    place: "Harbour Street, Meridia Old Town · a neighbourhood supermarket",
    blurb:
      "Three aisles, a produce corner and a wall of chillers, just before opening.",
    size: [22, 16],
    palette: {
      floor: "#d9d4c7",
      wall: "#efe9dc",
      rack: "#e8e8e4",
      accent: "#1f7a4a",
    },
    clock: "2026-11-21T07:48:31",
    camera: "HARBOUR ST · BODYCAM 01",
    zones: [
      { id: "entrance", label: "Entrance", rect: [0, 12, 8, 4] },
      {
        id: "aisle-1",
        label: "Aisle 1 · Tins & pasta",
        rect: [4.2, 3, 3.8, 9],
      },
      {
        id: "aisle-2",
        label: "Aisle 2 · Jars & sauces",
        rect: [9.2, 3, 3.8, 9],
      },
      { id: "back-aisle", label: "Back aisle", rect: [0, 0, 18, 3] },
      { id: "produce", label: "Produce", rect: [14.2, 10, 4, 6] },
      { id: "chillers", label: "Chillers", rect: [18, 0, 4, 16] },
      { id: "checkout", label: "Checkout", rect: [8, 12, 6, 4] },
    ],
    rooms: [],
    racks: [
      { id: "G1", rect: [3, 3, 1.2, 9], levels: 5, bay: 1.5, style: "gondola" },
      { id: "G2", rect: [8, 3, 1.2, 9], levels: 5, bay: 1.5, style: "gondola" },
      {
        id: "G3",
        rect: [13, 3, 1.2, 7],
        levels: 5,
        bay: 1.4,
        style: "gondola",
      },
    ],
    doors: [
      {
        id: "exit-north",
        kind: "exit",
        x: 16.2,
        y: 0,
        wall: "n",
        width: 1.2,
        open: 0,
        label: "FIRE EXIT",
      },
      { id: "front", kind: "dock", x: 3, y: 16, wall: "s", width: 3, open: 0 },
    ],
    props: [
      { id: "gap-g1", kind: "gap", rack: "G1", side: "e", bay: 2, level: 2 },
      { id: "gap-g1b", kind: "gap", rack: "G1", side: "e", bay: 2, level: 3 },
      {
        id: "labels-g2",
        kind: "no-labels",
        rack: "G2",
        side: "w",
        bay: 1,
        level: 1,
      },
      { id: "jar-aisle-2", kind: "broken-jar", x: 11.0, y: 6.8 },
      {
        id: "jar-sauce",
        kind: "puddle",
        x: 11.05,
        y: 6.85,
        r: 0.5,
        tint: "sauce",
      },
      { id: "carton-aisle-2", kind: "carton", x: 10.3, y: 9.6, rot: 0.4 },
      { id: "produce", kind: "produce", rect: [14.8, 11, 2.6, 4] },
      { id: "puddle-produce", kind: "puddle", x: 16.4, y: 10.2, r: 0.45 },
      { id: "sign-produce", kind: "wet-sign", x: 16.9, y: 10.0, rot: -0.4 },
      {
        id: "fridges",
        kind: "fridges",
        rect: [20.8, 1, 1.2, 14],
        face: "w",
        doors: 9,
        ajar: 5,
      },
      {
        id: "boxes-exit",
        kind: "pallet-stack",
        x: 16.2,
        y: 0.8,
        rot: -0.12,
        tall: 1.6,
      },
      { id: "checkout-1", kind: "checkout", x: 10.5, y: 14 },
      {
        id: "extinguisher-front",
        kind: "extinguisher",
        x: 0.25,
        y: 10.5,
        face: "e",
      },
    ],
    route: [
      [6.1, 14.6, 0],
      [6.1, 10.5, 3.6],
      [6.1, 3.4, 10.6],
      [7.4, 1.6, 12.6],
      [11.1, 1.6, 15.2],
      [11.1, 4.0, 17.4],
      [11.1, 10.8, 23.6],
      [13.0, 12.2, 25.6],
      [17.6, 12.0, 28.6],
      [18.4, 8.0, 31.6],
      [18.0, 3.0, 35.2],
      [17.0, 2.2, 37],
    ],
    glances: [
      { from: 4.0, to: 7.8, x: 4.2, y: 6.6, z: 1.1 },
      { from: 7.8, to: 10.2, x: 8.0, y: 5.25, z: 0.55 },
      { from: 16.4, to: 20.6, x: 11.0, y: 6.8, z: 0.45 },
      { from: 26.0, to: 28.0, x: 16.4, y: 10.6, z: 0.3 },
      { from: 28.4, to: 31.4, x: 20.6, y: 9.6, z: 1.1 },
      { from: 34.6, to: 37, x: 16.2, y: 0, z: 1.1 },
    ],
    planted: [
      {
        id: "p-gap",
        rule: "shelves-stocked",
        props: ["gap-g1", "gap-g1b"],
        note: "A whole bay of Aisle 1 is empty on two shelves.",
      },
      {
        id: "p-labels",
        rule: "price-labelled",
        props: ["labels-g2"],
        note: "One shelf edge in Aisle 1 has stock but no price labels.",
      },
      {
        id: "p-jar",
        rule: "spill-marked",
        props: ["jar-aisle-2", "jar-sauce"],
        note: "A smashed jar of sauce in Aisle 2, no sign.",
      },
      {
        id: "p-carton",
        rule: "aisle-clear",
        props: ["carton-aisle-2"],
        note: "An open carton left in Aisle 2.",
      },
      {
        id: "p-fridge",
        rule: "cold-door-shut",
        props: ["fridges"],
        note: "One chiller door stands open.",
      },
      {
        id: "p-exit",
        rule: "exits-clear",
        props: ["boxes-exit"],
        note: "Boxes are stacked against the fire exit.",
      },
      {
        id: "d-puddle",
        rule: "spill-marked",
        props: ["puddle-produce", "sign-produce"],
        decoy: true,
        note: "Water by the produce, already signed.",
      },
    ],
  },
];

export function siteBySlug(slug: string): Site | undefined {
  return SITES.find((site) => site.slug === slug);
}

/** Where the camera is at `t`: linear between waypoints, held at the ends. */
export function routeAt(
  route: readonly Waypoint[],
  t: number,
): [number, number] {
  const first = route[0];
  if (!first) return [0, 0];
  if (t <= first[2]) return [first[0], first[1]];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Waypoint;
    const b = route[i] as Waypoint;
    if (t <= b[2]) {
      const k = (t - a[2]) / Math.max(1e-6, b[2] - a[2]);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
  }
  const last = route[route.length - 1] as Waypoint;
  return [last[0], last[1]];
}

export function zoneAt(site: Site, x: number, y: number): Zone | undefined {
  // Later, smaller zones win over the big ones they sit in.
  return [...site.zones]
    .reverse()
    .find(
      (zone) =>
        x >= zone.rect[0] &&
        x <= zone.rect[0] + zone.rect[2] &&
        y >= zone.rect[1] &&
        y <= zone.rect[1] + zone.rect[3],
    );
}
