/**
 * The Catalog of Meridia: every table's description, columns and exact row
 * count, and the generator that yields its rows in column order.
 */
import { AIR_QUALITY_ROWS, airQualityRows } from "./air";
import { CARD_SPEND_ROWS, cardSpendRows } from "./banking";
import {
  BUDGET_LINE_ROWS,
  BUDGET_TOTAL_ROWS,
  budgetLineRows,
  budgetTotalRows,
} from "./budget";
import { HOURS, hourString } from "./calendar";
import {
  GRID_GENERATION_ROWS,
  gridGenerationRows,
  gridLoadRows,
} from "./energy";
import {
  AIR_STATIONS,
  BANK_NAME,
  BRANCHES,
  MUNICIPALITIES,
  REGIONS,
  ROUTES,
  stationPoint,
} from "./geography";
import { harbourCallRows, harbourPlan } from "./harbour";
import { householdSurveyRows, SURVEY_ROWS } from "./survey";
import { RIDERSHIP_ROWS, ridershipRows } from "./transport";
import type { CatalogColumn, CatalogTable, Cell, ColumnType } from "./types";
import { weather } from "./weather";

/** Bump whenever any generated value changes. */
export const DATA_VERSION = "meridia-2025.1";

function col(
  name: string,
  type: ColumnType,
  description: string,
  extra: Partial<CatalogColumn> = {},
): CatalogColumn {
  return { name, type, description, ...extra };
}

const regionCode = col(
  "region_code",
  "varchar",
  "Three-letter region code; joins to regions.region_code.",
);

type TableSpec = CatalogTable & { generate: () => Generator<Cell[]> };

function* fromArray(rows: Cell[][]): Generator<Cell[]> {
  yield* rows;
}

function* weatherRows(): Generator<Cell[]> {
  const w = weather();
  for (let h = 0; h < HOURS; h++) {
    const ts = hourString(h);
    for (let r = 0; r < REGIONS.length; r++) {
      const i = r * HOURS + h;
      yield [
        ts,
        REGIONS[r].code,
        w.temperature[i],
        w.wind[i],
        w.rain[i],
        w.humidity[i],
        w.solar[i],
      ];
    }
  }
}

const TABLES: TableSpec[] = [
  {
    name: "regions",
    title: "Regions",
    description:
      "The eight regions of the Republic of Meridia, with population, area and where they sit on the national map (a 1000 x 700 canvas, y down).",
    group: "reference",
    grain: "One row per region.",
    rows: REGIONS.length,
    columns: [
      col("region_code", "varchar", "Three-letter region code."),
      col("name", "varchar", "Region name."),
      col("capital", "varchar", "Regional capital."),
      col("population", "integer", "Residents, 2025 estimate.", {
        unit: "people",
      }),
      col("area_km2", "integer", "Land area.", { unit: "km²" }),
      col("coastal", "boolean", "Whether the region has a sea coast."),
      col("centroid_x", "integer", "Map x of the region's centre (0..1000)."),
      col(
        "centroid_y",
        "integer",
        "Map y of the region's centre (0..700, y down).",
      ),
    ],
    generate: () =>
      fromArray(
        REGIONS.map((r) => [
          r.code,
          r.name,
          r.capital,
          r.population,
          r.areaKm2,
          r.coastal,
          r.centroid[0],
          r.centroid[1],
        ]),
      ),
  },
  {
    name: "municipalities",
    title: "Municipalities",
    description:
      "The 48 municipalities, six per region, with their population.",
    group: "reference",
    grain: "One row per municipality.",
    rows: MUNICIPALITIES.length,
    columns: [
      col("municipality", "varchar", "Municipality name (unique)."),
      regionCode,
      col("population", "integer", "Residents, 2025 estimate.", {
        unit: "people",
      }),
    ],
    generate: () =>
      fromArray(
        MUNICIPALITIES.map((m) => [m.name, m.regionCode, m.population]),
      ),
  },
  {
    name: "grid_load",
    title: "Electricity demand",
    description:
      "Hourly electricity demand by region, 2025. Follows the working day, the season and temperature (heating in winter, cooling in summer).",
    group: "energy",
    grain: "One row per region per hour.",
    rows: REGIONS.length * HOURS,
    columns: [
      col("ts", "timestamp", "Start of the hour, local time."),
      regionCode,
      col("load_mw", "double", "Average demand during the hour.", {
        unit: "MW",
      }),
    ],
    generate: gridLoadRows,
  },
  {
    name: "grid_generation",
    title: "Electricity generation",
    description:
      "Hourly generation by region and source, 2025. Wind and solar follow the weather, hydro follows the season and rain, gas fills the gap. Nationally, generation each hour equals load plus 4-6% network losses; a region's generation need not equal its own load.",
    group: "energy",
    grain:
      "One row per region per source per hour (only the sources a region has).",
    rows: GRID_GENERATION_ROWS,
    columns: [
      col("ts", "timestamp", "Start of the hour, local time."),
      regionCode,
      col("source", "varchar", "hydro, wind, solar, gas, coal or imports."),
      col("generation_mw", "double", "Average output during the hour.", {
        unit: "MW",
      }),
    ],
    generate: gridGenerationRows,
  },
  {
    name: "weather",
    title: "Weather",
    description:
      "Hourly weather observations at each region's main station, 2025.",
    group: "weather",
    grain: "One row per region per hour.",
    rows: REGIONS.length * HOURS,
    columns: [
      col("ts", "timestamp", "Start of the hour, local time."),
      regionCode,
      col("temperature_c", "double", "Air temperature.", { unit: "°C" }),
      col("wind_ms", "double", "Mean wind speed.", { unit: "m/s" }),
      col("rain_mm", "double", "Rain during the hour.", { unit: "mm" }),
      col("humidity_pct", "integer", "Relative humidity.", { unit: "%" }),
      col("solar_wm2", "integer", "Global horizontal irradiance.", {
        unit: "W/m²",
      }),
    ],
    generate: weatherRows,
  },
  {
    name: "air_stations",
    title: "Air quality stations",
    description: "The twelve air quality monitoring stations.",
    group: "air",
    grain: "One row per station.",
    rows: AIR_STATIONS.length,
    columns: [
      col("station_id", "varchar", "Station id."),
      col("name", "varchar", "Station name."),
      regionCode,
      col("municipality", "varchar", "Municipality the station is in."),
      col("setting", "varchar", "urban, suburban, rural or coastal."),
      col("x", "integer", "Map x (0..1000)."),
      col("y", "integer", "Map y (0..700, y down)."),
    ],
    generate: () =>
      fromArray(
        AIR_STATIONS.map((s) => {
          const [x, y] = stationPoint(s);
          return [s.id, s.name, s.regionCode, s.municipality, s.setting, x, y];
        }),
      ),
  },
  {
    name: "air_quality",
    title: "Air quality",
    description:
      "Hourly pollutant concentrations at each station, 2025. NO2 tracks traffic, PM2.5 adds winter heating, ozone tracks sun and heat; wind disperses and rain washes out.",
    group: "air",
    grain: "One row per station per hour.",
    rows: AIR_QUALITY_ROWS,
    columns: [
      col("ts", "timestamp", "Start of the hour, local time."),
      col("station_id", "varchar", "Station id; joins to air_stations."),
      regionCode,
      col("pm25", "double", "Fine particulate matter.", { unit: "µg/m³" }),
      col("no2", "double", "Nitrogen dioxide.", { unit: "µg/m³" }),
      col("o3", "double", "Ozone.", { unit: "µg/m³" }),
    ],
    generate: airQualityRows,
  },
  {
    name: "transport_routes",
    title: "Ferry routes and rail lines",
    description:
      "Every ferry route and rail line in the ridership table, with when it opened.",
    group: "transport",
    grain: "One row per route.",
    rows: ROUTES.length,
    columns: [
      col("route_id", "varchar", "Route id (FR- ferry, RL- rail)."),
      col("mode", "varchar", "ferry or rail."),
      col("name", "varchar", "Route name."),
      col("from_place", "varchar", "One end of the route."),
      col("to_place", "varchar", "The other end."),
      regionCode,
      col("opened", "date", "Date the route opened."),
      col("length_km", "integer", "Route length.", { unit: "km" }),
    ],
    generate: () =>
      fromArray(
        ROUTES.map((r) => [
          r.id,
          r.mode,
          r.name,
          r.from,
          r.to,
          r.regionCode,
          r.opened,
          r.lengthKm,
        ]),
      ),
  },
  {
    name: "ridership",
    title: "Ridership",
    description:
      "Boardings per route per service hour, 2025 (ferries 06-22, rail 05-23; a route appears from the day it opened). A cancelled hour has no boardings.",
    group: "transport",
    grain: "One row per route per service hour.",
    rows: RIDERSHIP_ROWS,
    columns: [
      col("date", "date", "Service date."),
      col("hour", "integer", "Hour of day, 0-23."),
      col("route_id", "varchar", "Route id; joins to transport_routes."),
      col("mode", "varchar", "ferry or rail."),
      col("boardings", "integer", "Passengers who boarded in the hour.", {
        unit: "people",
      }),
      col("capacity", "integer", "Places offered in the hour.", {
        unit: "people",
      }),
      col(
        "cancelled",
        "boolean",
        "Whether the hour's services were cancelled.",
      ),
    ],
    generate: ridershipRows,
  },
  {
    name: "harbour_calls",
    title: "Harbour calls",
    description: "Every vessel call at Meridia's five commercial ports, 2025.",
    group: "harbour",
    grain: "One row per vessel call.",
    rows: harbourPlan().total,
    columns: [
      col("call_id", "varchar", "Call id, in order of arrival."),
      col("port", "varchar", "Port name."),
      regionCode,
      col(
        "vessel_type",
        "varchar",
        "container, bulk, tanker, ferry, fishing or cruise.",
      ),
      col("arrival_ts", "timestamp", "Arrival at berth, local time."),
      col(
        "departure_ts",
        "timestamp",
        "Departure from berth, local time (may fall in 2026).",
      ),
      col("berth_hours", "double", "Hours at berth.", { unit: "h" }),
      col("cargo_tonnes", "integer", "Cargo handled (0 for cruise ships).", {
        unit: "t",
      }),
      col(
        "teu",
        "integer",
        "Containers handled, twenty-foot equivalents (container ships only, otherwise empty).",
        { unit: "TEU" },
      ),
    ],
    generate: harbourCallRows,
  },
  {
    name: "municipal_budget_lines",
    title: "Municipal budget lines",
    description:
      "Budgeted and actual spending per line item, per municipality, fiscal years 2021-2025.",
    group: "budget",
    grain: "One row per fiscal year per municipality per line item.",
    rows: BUDGET_LINE_ROWS,
    columns: [
      col("fiscal_year", "integer", "Fiscal year."),
      col("municipality", "varchar", "Municipality; joins to municipalities."),
      regionCode,
      col("category", "varchar", "Spending category."),
      col("line_item", "varchar", "Line item within the category."),
      col("budgeted_mdc", "integer", "Budget adopted for the year.", {
        unit: "MDC",
      }),
      col("actual_mdc", "integer", "Actual spending in the year.", {
        unit: "MDC",
      }),
    ],
    generate: budgetLineRows,
  },
  {
    name: "municipal_budget_totals",
    title: "Municipal budget totals",
    description:
      "The totals each municipality reported for the year, as published.",
    group: "budget",
    grain: "One row per fiscal year per municipality.",
    rows: BUDGET_TOTAL_ROWS,
    columns: [
      col("fiscal_year", "integer", "Fiscal year."),
      col("municipality", "varchar", "Municipality; joins to municipalities."),
      regionCode,
      col("reported_budget_mdc", "integer", "Reported total budget.", {
        unit: "MDC",
      }),
      col("reported_actual_mdc", "integer", "Reported total actual spending.", {
        unit: "MDC",
      }),
    ],
    generate: budgetTotalRows,
  },
  {
    name: "household_survey",
    title: "Household survey",
    description:
      "The 2025 household survey: one row per responding household. Weight by survey_weight to estimate national figures.",
    group: "survey",
    grain: "One row per household.",
    rows: SURVEY_ROWS,
    columns: [
      col("household_id", "varchar", "Anonymised household id.", {
        restrictedByDefault: true,
      }),
      regionCode,
      col("municipality", "varchar", "Municipality of residence."),
      col("household_size", "integer", "People in the household.", {
        unit: "people",
      }),
      col(
        "monthly_income_mdc",
        "integer",
        "Household income after tax, per month.",
        { unit: "MDC", restrictedByDefault: true },
      ),
      col(
        "monthly_energy_spend_mdc",
        "double",
        "Electricity and heating spend, monthly average.",
        { unit: "MDC" },
      ),
      col(
        "housing_tenure",
        "varchar",
        "owner_outright, mortgage, private_rent or social_rent.",
      ),
      col("has_car", "boolean", "Whether the household has a car."),
      col(
        "commute_mode",
        "varchar",
        "Respondent's main commute: car, rail, bus, ferry, bike, walk or none.",
      ),
      col(
        "commute_minutes",
        "integer",
        "One-way commute time (empty when commute_mode is none).",
        { unit: "min" },
      ),
      col("respondent_age", "integer", "Age of the respondent.", {
        unit: "years",
        restrictedByDefault: true,
      }),
      col("survey_weight", "double", "Households this response stands for."),
    ],
    generate: householdSurveyRows,
  },
  {
    name: "bank_branches",
    title: `${BANK_NAME} branches`,
    description: `The 24 branches of ${BANK_NAME}, a fictional Meridian savings bank, whose catchments the card spend table covers.`,
    group: "banking",
    grain: "One row per branch.",
    rows: BRANCHES.length,
    columns: [
      col("branch_id", "varchar", "Branch id."),
      col("name", "varchar", "Branch name."),
      regionCode,
      col("municipality", "varchar", "Municipality the branch is in."),
      col("coastal", "boolean", "Whether the branch's region is coastal."),
      col("opened", "date", "Date the branch opened."),
    ],
    generate: () =>
      fromArray(
        BRANCHES.map((b) => [
          b.id,
          b.name,
          b.regionCode,
          b.municipality,
          b.coastal,
          b.opened,
        ]),
      ),
  },
  {
    name: "card_spend",
    title: "Card spend",
    description: `Anonymous daily card spend by cardholders of ${BANK_NAME} in each branch's catchment, by merchant category, 2025. Aggregated: no individual transactions.`,
    group: "banking",
    grain: "One row per day per branch per merchant category.",
    rows: CARD_SPEND_ROWS,
    columns: [
      col("date", "date", "Day of spend."),
      col("branch_id", "varchar", "Branch id; joins to bank_branches."),
      regionCode,
      col("category", "varchar", "Merchant category."),
      col("transactions", "integer", "Number of card transactions."),
      col("amount_mdc", "double", "Total spend.", { unit: "MDC" }),
    ],
    generate: cardSpendRows,
  },
];

export const CATALOG: readonly CatalogTable[] = TABLES.map(
  ({ generate: _, ...table }) => table,
);

const BY_NAME = new Map(TABLES.map((t) => [t.name, t]));

/** Rows of a table, in column order. Throws on an unknown table. */
export function tableRows(name: string): Generator<Cell[]> {
  const table = BY_NAME.get(name);
  if (!table) throw new Error(`Unknown Meridia table: ${name}`);
  return table.generate();
}
