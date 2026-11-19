/**
 * The structure planted in the open data of Meridia: the events an analyst can
 * find, where and when they are, and how big their effect is. Generators read
 * these values; tests and sample questions refer to them by id.
 */

export type StoryId =
  | "heatwave"
  | "ferry-strike"
  | "budget-gap"
  | "storm"
  | "new-rail";

export type Holiday = { date: string; name: string };

export type StoryEvent = {
  id: StoryId;
  title: string;
  summary: string;
  /** The tables where the effect shows. */
  tables: readonly string[];
};

export type Story = {
  year: 2025;
  holidays: readonly Holiday[];
  /** Days after which card spend jumps: the 15th and the last day of each month. */
  paydays: string;
  heatwave: StoryEvent & {
    start: string;
    end: string;
    regions: readonly string[];
    /** Added to the normal daily temperature, in °C. */
    temperatureAnomalyC: readonly [number, number];
    /** Daily peak load in the heatwave regions vs. the other February weeks, %. */
    loadPeakIncreasePct: readonly [number, number];
    /** The hour of the year's national peak load falls inside the heatwave. */
    nationalPeakInside: true;
    /** Hydro output in the heatwave regions is multiplied by this. */
    hydroFactor: number;
  };
  ferryStrike: StoryEvent & {
    start: string;
    end: string;
    /** Rail lines that run beside a ferry route and take its riders. */
    parallelRail: readonly { railRouteId: string; ferryRouteId: string }[];
    railIncreasePct: readonly [number, number];
    /** Card spend in the `transport` category at coastal branches. */
    transportSpendDropPct: readonly [number, number];
  };
  budgetGap: StoryEvent & {
    region: string;
    fiscalYears: readonly number[];
    /** reported_actual_mdc exceeds the sum of the lines by this much, %. */
    overstatementPct: readonly [number, number];
  };
  storm: StoryEvent & {
    port: string;
    region: string;
    /** Regions where wind and rain are high, the port's first. */
    regions: readonly string[];
    start: string;
    end: string;
    /** The port takes no arrivals from closedFrom until closedUntil. */
    closedFrom: string;
    closedUntil: string;
    peakWindMs: readonly [number, number];
    /** Rain per day in the port's region during the storm, mm. */
    dailyRainMm: readonly [number, number];
    /** Days after the closure that carry the backlog of delayed arrivals. */
    backlogDays: number;
  };
  newRail: StoryEvent & {
    routeId: string;
    opened: string;
    fromFerryRouteId: string;
    /** Weekday boardings on the ferry fall by this much once the line opens, %. */
    ferryDropPct: readonly [number, number];
    /** Days the new line takes to reach its full ridership. */
    rampDays: number;
  };
};

export const STORY: Story = {
  year: 2025,
  holidays: [
    { date: "2025-01-01", name: "New Year's Day" },
    { date: "2025-03-10", name: "Founders' Day" },
    { date: "2025-04-18", name: "Lantern Friday" },
    { date: "2025-04-21", name: "Lantern Monday" },
    { date: "2025-06-23", name: "Charter Day" },
    { date: "2025-09-15", name: "Mariners' Day" },
    { date: "2025-10-27", name: "Labour Day" },
    { date: "2025-12-25", name: "Year's End Feast" },
    { date: "2025-12-26", name: "Second Feast" },
  ],
  paydays: "15th and last day of each month",
  heatwave: {
    id: "heatwave",
    title: "Northern heatwave",
    summary:
      "A week of heat in the three northern regions: temperatures 8 to 11 °C above normal, cooling pushes peak load up about 25% and sets the year's national peak hour, ozone and PM2.5 rise, hydro falls and gas fills the gap. The annual household survey does not show it.",
    tables: ["weather", "grid_load", "grid_generation", "air_quality"],
    start: "2025-02-10",
    end: "2025-02-16",
    regions: ["KES", "ARV", "TAM"],
    temperatureAnomalyC: [8, 11],
    loadPeakIncreasePct: [18, 32],
    nationalPeakInside: true,
    hydroFactor: 0.6,
  },
  ferryStrike: {
    id: "ferry-strike",
    title: "Ferry strike",
    summary:
      "Ferry crews strike for three days: every ferry service is cancelled, the rail lines beside ferry routes carry 30 to 40% more, transport card spend at coastal branches falls and no ferry calls at any port.",
    tables: ["ridership", "harbour_calls", "card_spend"],
    start: "2025-05-14",
    end: "2025-05-16",
    parallelRail: [
      { railRouteId: "RL-02", ferryRouteId: "FR-02" },
      { railRouteId: "RL-03", ferryRouteId: "FR-03" },
      { railRouteId: "RL-07", ferryRouteId: "FR-07" },
      { railRouteId: "RL-08", ferryRouteId: "FR-05" },
    ],
    railIncreasePct: [30, 40],
    transportSpendDropPct: [25, 45],
  },
  budgetGap: {
    id: "budget-gap",
    title: "Velmora's totals do not add up",
    summary:
      "In every municipality of Velmora, for fiscal years 2023 to 2025, the reported actual total is 3 to 9% higher than the sum of its own budget lines. Everywhere else the totals equal the lines to the crown.",
    tables: ["municipal_budget_lines", "municipal_budget_totals"],
    region: "VEL",
    fiscalYears: [2023, 2024, 2025],
    overstatementPct: [3, 9],
  },
  storm: {
    id: "storm",
    title: "Storm closes Port Halden",
    summary:
      "A winter storm brings 20+ m/s winds and heavy rain to the south coast. Port Halden takes no arrivals for two days and works off a backlog in the three days after; ferries in the storm regions are cancelled and card spend in Haldenmouth dips.",
    tables: [
      "weather",
      "harbour_calls",
      "ridership",
      "card_spend",
      "grid_generation",
    ],
    port: "Port Halden",
    region: "HAL",
    regions: ["HAL", "SAL", "FEN"],
    start: "2025-08-12",
    end: "2025-08-13",
    closedFrom: "2025-08-12 00:00:00",
    closedUntil: "2025-08-14 00:00:00",
    peakWindMs: [20, 29],
    dailyRainMm: [55, 95],
    backlogDays: 3,
  },
  newRail: {
    id: "new-rail",
    title: "Saltmere Crosslink opens",
    summary:
      "A new rail line from Brennick to Port Halden opens on 1 July and takes about a third of the Saltmere Ferry's riders within three weeks.",
    tables: ["transport_routes", "ridership"],
    routeId: "RL-12",
    opened: "2025-07-01",
    fromFerryRouteId: "FR-04",
    ferryDropPct: [25, 45],
    rampDays: 21,
  },
};

export const STORY_EVENTS: readonly StoryEvent[] = [
  STORY.heatwave,
  STORY.ferryStrike,
  STORY.budgetGap,
  STORY.storm,
  STORY.newRail,
];
