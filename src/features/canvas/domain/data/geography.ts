/**
 * The places of the fictional Republic of Meridia: regions (with a drawable
 * map on a 1000 x 700 canvas, y down), municipalities, air stations, ferry
 * routes and rail lines, ports, bank branches and the power plants by region.
 * Every name is invented.
 */
import { rngFor } from "./prng";

type Point = [number, number];

// Shared vertices, so neighbouring regions share edges exactly.
// North coast.
const P0: Point = [100, 110];
const P1: Point = [220, 70];
const P2: Point = [340, 60];
const P3: Point = [460, 85];
const P4: Point = [570, 60];
const P5: Point = [700, 75];
const P6: Point = [820, 95];
const P7: Point = [900, 170];
// North / middle boundary.
const Q0: Point = [80, 270];
const Q1: Point = [330, 250];
const Q2: Point = [570, 265];
const Q3: Point = [940, 300];
// Middle / south boundary.
const R0: Point = [110, 470];
const R1: Point = [360, 455];
const R2: Point = [620, 480];
const R3: Point = [900, 460];
// East and south coast, south-west corner.
const E1: Point = [960, 380];
const T0: Point = [200, 630];
const T1: Point = [420, 650];
const T2: Point = [660, 660];
const T3: Point = [870, 580];
const W0: Point = [120, 590];

type RegionSeed = {
  code: string;
  name: string;
  capital: string;
  population: number;
  coastal: boolean;
  polygon: Point[];
  /** Mean annual temperature, °C. */
  meanTempC: number;
  /** Latitude for the sun, degrees (negative: south). */
  latitude: number;
};

const REGION_SEEDS: RegionSeed[] = [
  {
    code: "KES",
    name: "Kestrel Coast",
    capital: "Lunmark",
    population: 550_000,
    coastal: true,
    polygon: [P0, P1, P2, Q1, Q0],
    meanTempC: 19.5,
    latitude: -34.5,
  },
  {
    code: "ARV",
    name: "Arvena",
    capital: "Solcaster",
    population: 820_000,
    coastal: true,
    polygon: [P2, P3, P4, Q2, Q1],
    meanTempC: 20.5,
    latitude: -34.2,
  },
  {
    code: "TAM",
    name: "Tamsin Bay",
    capital: "Orrinby",
    population: 610_000,
    coastal: true,
    polygon: [P4, P5, P6, P7, Q3, Q2],
    meanTempC: 20,
    latitude: -34.6,
  },
  {
    code: "VEL",
    name: "Velmora",
    capital: "Haskett",
    population: 460_000,
    coastal: false,
    polygon: [Q0, Q1, R1, R0],
    meanTempC: 16.5,
    latitude: -36.8,
  },
  {
    code: "DUR",
    name: "Durrany",
    capital: "Aurel",
    population: 1_240_000,
    coastal: false,
    polygon: [Q1, Q2, R2, R1],
    meanTempC: 17,
    latitude: -36.9,
  },
  {
    code: "SAL",
    name: "Saltmere",
    capital: "Brennick",
    population: 700_000,
    coastal: true,
    polygon: [Q2, Q3, E1, R3, R2],
    meanTempC: 16.5,
    latitude: -37.2,
  },
  {
    code: "FEN",
    name: "Fennory Shore",
    capital: "Corranth",
    population: 510_000,
    coastal: true,
    polygon: [R0, R1, T1, T0, W0],
    meanTempC: 14,
    latitude: -39.4,
  },
  {
    code: "HAL",
    name: "Haldenmouth",
    capital: "Port Halden",
    population: 1_410_000,
    coastal: true,
    polygon: [R1, R2, R3, T3, T2, T1],
    meanTempC: 14.5,
    latitude: -39.2,
  },
];

function polygonArea(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function polygonCentroid(polygon: Point[]): Point {
  const area = polygonArea(polygon);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [Math.round(cx / (6 * area)), Math.round(cy / (6 * area))];
}

/** One canvas unit is half a kilometre. */
const KM_PER_UNIT = 0.5;

export type Region = {
  code: string;
  name: string;
  capital: string;
  population: number;
  coastal: boolean;
  centroid: [number, number];
  polygon: [number, number][];
  areaKm2: number;
  meanTempC: number;
  latitude: number;
};

export const REGIONS: readonly Region[] = REGION_SEEDS.map((seed) => ({
  ...seed,
  centroid: polygonCentroid(seed.polygon),
  areaKm2: Math.round(
    Math.abs(polygonArea(seed.polygon)) * KM_PER_UNIT * KM_PER_UNIT,
  ),
}));

export const REGION_INDEX: Readonly<Record<string, number>> =
  Object.fromEntries(REGIONS.map((r, i) => [r.code, i]));

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Municipalities -------------------------------------------------------------------------

const MUNICIPALITY_NAMES: Record<string, string[]> = {
  KES: [
    "Lunmark",
    "Skerrow",
    "Brackenhyde",
    "Wendlecove",
    "Ashorrow",
    "Tillmere",
  ],
  ARV: [
    "Solcaster",
    "Tolley Point",
    "Varnhold",
    "Quillon",
    "Eskerby",
    "Dunmarrow",
  ],
  TAM: [
    "Orrinby",
    "Westerhyne",
    "Callowmere",
    "Pennick",
    "Strathorn",
    "Ivelby",
  ],
  VEL: [
    "Haskett",
    "Corrimoor",
    "Ellisvane",
    "Gravenholt",
    "Myrtlebeck",
    "Oskerry",
  ],
  DUR: [
    "Aurel",
    "Kinterly",
    "Bramsholt",
    "Durrany Vale",
    "Thessin",
    "Ouldmere",
  ],
  SAL: [
    "Brennick",
    "Saltmere Quay",
    "Harrowdene",
    "Linnock",
    "Pellam",
    "Rushmerrow",
  ],
  FEN: [
    "Corranth",
    "Marrow Isle",
    "Fennory Mouth",
    "Garrowby",
    "Silverlea",
    "Tamblin",
  ],
  HAL: [
    "Port Halden",
    "Gullscar",
    "Pellow Island",
    "Halden Heights",
    "Nevercombe",
    "Ostrevale",
  ],
};

export type Municipality = {
  name: string;
  regionCode: string;
  population: number;
};

function buildMunicipalities(): Municipality[] {
  const rng = rngFor("municipalities");
  const out: Municipality[] = [];
  for (const region of REGIONS) {
    const names = MUNICIPALITY_NAMES[region.code];
    // The capital holds 30-40%; the rest share what is left by random weight.
    const capitalShare = rng.range(0.3, 0.4);
    const weights = names.slice(1).map(() => rng.range(0.4, 1.6));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const pops = [
      Math.round(region.population * capitalShare),
      ...weights.map((w) =>
        Math.round((region.population * (1 - capitalShare) * w) / weightSum),
      ),
    ];
    // Make the region total exact.
    pops[0] += region.population - pops.reduce((a, b) => a + b, 0);
    names.forEach((name, i) => {
      out.push({ name, regionCode: region.code, population: pops[i] });
    });
  }
  return out;
}

export const MUNICIPALITIES: readonly Municipality[] = buildMunicipalities();

// Air stations ---------------------------------------------------------------------------

export type AirStation = {
  id: string;
  name: string;
  regionCode: string;
  municipality: string;
  setting: "urban" | "suburban" | "rural" | "coastal";
  /** Offset from the region centroid on the map. */
  offset: Point;
  /** How much traffic reaches the sensor, 0..1. */
  traffic: number;
};

export const AIR_STATIONS: readonly AirStation[] = [
  {
    id: "AQ-01",
    name: "Lunmark Central",
    regionCode: "KES",
    municipality: "Lunmark",
    setting: "urban",
    offset: [-20, -15],
    traffic: 0.7,
  },
  {
    id: "AQ-02",
    name: "Solcaster Exchange",
    regionCode: "ARV",
    municipality: "Solcaster",
    setting: "urban",
    offset: [-25, 10],
    traffic: 0.8,
  },
  {
    id: "AQ-03",
    name: "Varnhold Fields",
    regionCode: "ARV",
    municipality: "Varnhold",
    setting: "rural",
    offset: [30, -30],
    traffic: 0.2,
  },
  {
    id: "AQ-04",
    name: "Orrinby Wharf",
    regionCode: "TAM",
    municipality: "Orrinby",
    setting: "coastal",
    offset: [20, -20],
    traffic: 0.5,
  },
  {
    id: "AQ-05",
    name: "Haskett Works",
    regionCode: "VEL",
    municipality: "Haskett",
    setting: "suburban",
    offset: [10, 20],
    traffic: 0.5,
  },
  {
    id: "AQ-06",
    name: "Aurel Civic Square",
    regionCode: "DUR",
    municipality: "Aurel",
    setting: "urban",
    offset: [0, 0],
    traffic: 1,
  },
  {
    id: "AQ-07",
    name: "Kinterly Park",
    regionCode: "DUR",
    municipality: "Kinterly",
    setting: "suburban",
    offset: [-40, 30],
    traffic: 0.45,
  },
  {
    id: "AQ-08",
    name: "Brennick Harbour",
    regionCode: "SAL",
    municipality: "Brennick",
    setting: "coastal",
    offset: [40, 10],
    traffic: 0.55,
  },
  {
    id: "AQ-09",
    name: "Corranth Road",
    regionCode: "FEN",
    municipality: "Corranth",
    setting: "urban",
    offset: [10, -10],
    traffic: 0.65,
  },
  {
    id: "AQ-10",
    name: "Port Halden Docks",
    regionCode: "HAL",
    municipality: "Port Halden",
    setting: "urban",
    offset: [30, 15],
    traffic: 0.95,
  },
  {
    id: "AQ-11",
    name: "Gullscar Heath",
    regionCode: "HAL",
    municipality: "Gullscar",
    setting: "coastal",
    offset: [-60, 40],
    traffic: 0.3,
  },
  {
    id: "AQ-12",
    name: "Tolley Point",
    regionCode: "ARV",
    municipality: "Tolley Point",
    setting: "coastal",
    offset: [-60, -60],
    traffic: 0.25,
  },
];

export function stationPoint(station: AirStation): Point {
  const region = REGIONS[REGION_INDEX[station.regionCode]];
  return [
    region.centroid[0] + station.offset[0],
    region.centroid[1] + station.offset[1],
  ];
}

// Transport ------------------------------------------------------------------------------

export type Route = {
  id: string;
  mode: "ferry" | "rail";
  name: string;
  from: string;
  to: string;
  regionCode: string;
  opened: string;
  lengthKm: number;
  /** Boardings on an ordinary weekday. */
  dailyBoardings: number;
  /** Seats (rail) or passenger places (ferry) per service. */
  vehicleCapacity: number;
};

export const ROUTES: readonly Route[] = [
  {
    id: "FR-01",
    mode: "ferry",
    name: "Kestrel Sound Ferry",
    from: "Lunmark",
    to: "Skerrow",
    regionCode: "KES",
    opened: "1998-03-02",
    lengthKm: 14,
    dailyBoardings: 3400,
    vehicleCapacity: 420,
  },
  {
    id: "FR-02",
    mode: "ferry",
    name: "Arvena Bay Ferry",
    from: "Solcaster",
    to: "Tolley Point",
    regionCode: "ARV",
    opened: "1987-10-12",
    lengthKm: 11,
    dailyBoardings: 5200,
    vehicleCapacity: 480,
  },
  {
    id: "FR-03",
    mode: "ferry",
    name: "Tamsin Bay Crossing",
    from: "Orrinby",
    to: "Westerhyne",
    regionCode: "TAM",
    opened: "1991-05-20",
    lengthKm: 18,
    dailyBoardings: 4100,
    vehicleCapacity: 450,
  },
  {
    id: "FR-04",
    mode: "ferry",
    name: "Saltmere Ferry",
    from: "Brennick",
    to: "Port Halden",
    regionCode: "SAL",
    opened: "1979-08-01",
    lengthKm: 26,
    dailyBoardings: 6200,
    vehicleCapacity: 600,
  },
  {
    id: "FR-05",
    mode: "ferry",
    name: "Halden Harbour Shuttle",
    from: "Port Halden",
    to: "Gullscar",
    regionCode: "HAL",
    opened: "2004-11-15",
    lengthKm: 7,
    dailyBoardings: 7800,
    vehicleCapacity: 380,
  },
  {
    id: "FR-06",
    mode: "ferry",
    name: "Fennory Coast Ferry",
    from: "Corranth",
    to: "Marrow Isle",
    regionCode: "FEN",
    opened: "1995-02-06",
    lengthKm: 21,
    dailyBoardings: 2300,
    vehicleCapacity: 360,
  },
  {
    id: "FR-07",
    mode: "ferry",
    name: "Halden-Corranth Fast Ferry",
    from: "Port Halden",
    to: "Corranth",
    regionCode: "HAL",
    opened: "2012-06-04",
    lengthKm: 38,
    dailyBoardings: 3900,
    vehicleCapacity: 520,
  },
  {
    id: "FR-08",
    mode: "ferry",
    name: "Pellow Island Ferry",
    from: "Gullscar",
    to: "Pellow Island",
    regionCode: "HAL",
    opened: "1983-04-11",
    lengthKm: 16,
    dailyBoardings: 1900,
    vehicleCapacity: 300,
  },
  {
    id: "FR-09",
    mode: "ferry",
    name: "Northern Coastal Ferry",
    from: "Orrinby",
    to: "Lunmark",
    regionCode: "TAM",
    opened: "2009-09-28",
    lengthKm: 44,
    dailyBoardings: 1600,
    vehicleCapacity: 400,
  },
  {
    id: "RL-01",
    mode: "rail",
    name: "Northern Main Line",
    from: "Lunmark",
    to: "Orrinby",
    regionCode: "KES",
    opened: "1924-07-01",
    lengthKm: 182,
    dailyBoardings: 14_500,
    vehicleCapacity: 640,
  },
  {
    id: "RL-02",
    mode: "rail",
    name: "Arvena Coast Line",
    from: "Solcaster",
    to: "Tolley Point",
    regionCode: "ARV",
    opened: "1958-03-17",
    lengthKm: 34,
    dailyBoardings: 9_800,
    vehicleCapacity: 520,
  },
  {
    id: "RL-03",
    mode: "rail",
    name: "Tamsin Valley Line",
    from: "Orrinby",
    to: "Westerhyne",
    regionCode: "TAM",
    opened: "1966-09-05",
    lengthKm: 41,
    dailyBoardings: 7_600,
    vehicleCapacity: 480,
  },
  {
    id: "RL-04",
    mode: "rail",
    name: "Velmora Branch",
    from: "Haskett",
    to: "Aurel",
    regionCode: "VEL",
    opened: "1931-02-09",
    lengthKm: 96,
    dailyBoardings: 8_900,
    vehicleCapacity: 560,
  },
  {
    id: "RL-05",
    mode: "rail",
    name: "Aurel Airport Link",
    from: "Aurel",
    to: "Kinterly",
    regionCode: "DUR",
    opened: "2016-11-21",
    lengthKm: 23,
    dailyBoardings: 16_200,
    vehicleCapacity: 600,
  },
  {
    id: "RL-06",
    mode: "rail",
    name: "Central Main Line",
    from: "Aurel",
    to: "Port Halden",
    regionCode: "DUR",
    opened: "1912-05-13",
    lengthKm: 214,
    dailyBoardings: 21_500,
    vehicleCapacity: 760,
  },
  {
    id: "RL-07",
    mode: "rail",
    name: "Southern Coast Line",
    from: "Port Halden",
    to: "Corranth",
    regionCode: "HAL",
    opened: "1949-10-03",
    lengthKm: 118,
    dailyBoardings: 11_400,
    vehicleCapacity: 600,
  },
  {
    id: "RL-08",
    mode: "rail",
    name: "Halden Suburban",
    from: "Port Halden",
    to: "Gullscar",
    regionCode: "HAL",
    opened: "1971-04-26",
    lengthKm: 19,
    dailyBoardings: 19_800,
    vehicleCapacity: 700,
  },
  {
    id: "RL-09",
    mode: "rail",
    name: "Saltmere Line",
    from: "Brennick",
    to: "Aurel",
    regionCode: "SAL",
    opened: "1938-08-15",
    lengthKm: 152,
    dailyBoardings: 10_300,
    vehicleCapacity: 580,
  },
  {
    id: "RL-10",
    mode: "rail",
    name: "Fennory Line",
    from: "Corranth",
    to: "Haskett",
    regionCode: "FEN",
    opened: "1952-12-01",
    lengthKm: 133,
    dailyBoardings: 6_100,
    vehicleCapacity: 480,
  },
  {
    id: "RL-11",
    mode: "rail",
    name: "Durrany Ring",
    from: "Aurel",
    to: "Aurel",
    regionCode: "DUR",
    opened: "1999-06-14",
    lengthKm: 31,
    dailyBoardings: 24_800,
    vehicleCapacity: 820,
  },
  {
    id: "RL-12",
    mode: "rail",
    name: "Saltmere Crosslink",
    from: "Brennick",
    to: "Port Halden",
    regionCode: "SAL",
    opened: "2025-07-01",
    lengthKm: 58,
    dailyBoardings: 2_400,
    vehicleCapacity: 520,
  },
];

/** Service hours, inclusive: ferries 06-22, rail 05-23. */
export const SERVICE_HOURS: Record<Route["mode"], readonly [number, number]> = {
  ferry: [6, 22],
  rail: [5, 23],
};

// Ports ----------------------------------------------------------------------------------

export const VESSEL_TYPES = [
  "container",
  "bulk",
  "tanker",
  "ferry",
  "fishing",
  "cruise",
] as const;
export type VesselType = (typeof VESSEL_TYPES)[number];

export type Port = {
  name: string;
  regionCode: string;
  /** Mean arrivals per ordinary day, by vessel type. */
  dailyArrivals: Record<VesselType, number>;
};

export const PORTS: readonly Port[] = [
  {
    name: "Port Halden",
    regionCode: "HAL",
    dailyArrivals: {
      container: 9,
      bulk: 4.2,
      tanker: 3,
      ferry: 28,
      fishing: 9.5,
      cruise: 0.45,
    },
  },
  {
    name: "Brennick",
    regionCode: "SAL",
    dailyArrivals: {
      container: 2.4,
      bulk: 2,
      tanker: 1.1,
      ferry: 13,
      fishing: 6.5,
      cruise: 0.15,
    },
  },
  {
    name: "Orrinby",
    regionCode: "TAM",
    dailyArrivals: {
      container: 0.8,
      bulk: 1.5,
      tanker: 0.6,
      ferry: 10,
      fishing: 6.5,
      cruise: 0.2,
    },
  },
  {
    name: "Lunmark",
    regionCode: "KES",
    dailyArrivals: {
      container: 0.4,
      bulk: 1,
      tanker: 0.4,
      ferry: 7.5,
      fishing: 5,
      cruise: 0.12,
    },
  },
  {
    name: "Corranth",
    regionCode: "FEN",
    dailyArrivals: {
      container: 0.5,
      bulk: 0.9,
      tanker: 0.5,
      ferry: 8.5,
      fishing: 6,
      cruise: 0.08,
    },
  },
];

// Energy ---------------------------------------------------------------------------------

export const SOURCES = [
  "hydro",
  "wind",
  "solar",
  "gas",
  "coal",
  "imports",
] as const;
export type Source = (typeof SOURCES)[number];

/** Installed capacity by region and source, MW. A missing source is absent. */
export const CAPACITY_MW: Record<string, Partial<Record<Source, number>>> = {
  KES: { hydro: 380, wind: 520, solar: 300, gas: 420, coal: 120, imports: 80 },
  ARV: { hydro: 300, wind: 260, solar: 520, gas: 640, coal: 260, imports: 60 },
  TAM: { hydro: 420, wind: 480, solar: 380, gas: 450, coal: 90, imports: 60 },
  VEL: { hydro: 260, wind: 220, solar: 260, gas: 360, coal: 620, imports: 220 },
  DUR: { wind: 180, solar: 420, gas: 1250, coal: 300, imports: 90 },
  SAL: { hydro: 200, wind: 600, solar: 240, gas: 620, coal: 100, imports: 50 },
  FEN: { wind: 560, solar: 200, gas: 420, imports: 120 },
  HAL: {
    hydro: 120,
    wind: 400,
    solar: 260,
    gas: 1300,
    coal: 180,
    imports: 140,
  },
};

/** The sources each region has, in SOURCES order. */
export const REGION_SOURCES: readonly (readonly Source[])[] = REGIONS.map((r) =>
  SOURCES.filter((s) => CAPACITY_MW[r.code][s] !== undefined),
);

// Banking --------------------------------------------------------------------------------

export const BANK_NAME = "Corvane Savings Bank";

export type Branch = {
  id: string;
  name: string;
  regionCode: string;
  municipality: string;
  coastal: boolean;
  opened: string;
  /** Relative catchment size. */
  size: number;
};

function buildBranches(): Branch[] {
  const rng = rngFor("bank_branches");
  const out: Branch[] = [];
  for (const region of REGIONS) {
    const towns = MUNICIPALITIES.filter((m) => m.regionCode === region.code)
      .slice()
      .sort((a, b) => b.population - a.population)
      .slice(0, 3);
    for (const town of towns) {
      const n = out.length + 1;
      out.push({
        id: `CSB-${String(n).padStart(2, "0")}`,
        name: `${BANK_NAME} ${town.name}`,
        regionCode: region.code,
        municipality: town.name,
        coastal: region.coastal,
        opened: `${rng.int(1962, 2019)}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`,
        size: Math.sqrt(town.population / 100_000) * rng.range(0.85, 1.15),
      });
    }
  }
  return out;
}

export const BRANCHES: readonly Branch[] = buildBranches();
