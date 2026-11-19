# Canvas data: the open data of Meridia (SPECIMEN)

**SPECIMEN. Synthetic data about the fictional Republic of Meridia.** No real
country, region, town, port, vessel, bank, company or person is described. The
numbers are drawn from a seed. The same seed and code give the same bytes on
every machine.

The Canvas Analyst answers questions about this Catalog. It loads the tables
into DuckDB inside its Sandbox. At about a million rows the data is too big to
read, so questions are answered by writing SQL and code.

- Generator: `src/features/canvas/domain/data/` (pure TypeScript, seeded mulberry32,
  no clock, no `Math.random`). Each table's seed comes from its own name, so tables
  can be generated in any order. Hourly weather and load are shared
  intermediates: each is computed once and cached.
- Manifest: `fixtures/canvas/catalog.json` holds the data version, every table's
  columns and exact row count, and the sha256 of its CSV.
- Version: `DATA_VERSION` in `catalog.ts` (`meridia-2025.1`). Bump it whenever any
  generated value changes.

## Regenerate

```
pnpm render:canvas-data                               # catalog.json + the two samples
node --experimental-strip-types scripts/render-canvas-data.mts --out /tmp/meridia
                                                      # ...and every table's full CSV
```

Re-running the script changes nothing. The full CSVs (about 40 MB) are never
committed.

## Tables

Calendar year 2025, local Meridia time with no timezone. Timestamps are
`YYYY-MM-DD HH:MM:SS` and dates are `YYYY-MM-DD`. Money is in Meridian crowns
(MDC). Meridia is in the southern hemisphere, so summer runs from December to
February. The north is warmer and the south is colder, wetter and windier.

| Table | Rows | Grain |
| --- | ---: | --- |
| `regions` | 8 | region (code, capital, population, area, coastal, map centroid) |
| `municipalities` | 48 | municipality, six per region |
| `grid_load` | 70,080 | region × hour |
| `grid_generation` | 394,200 | region × hour × source the region has (hydro, wind, solar, gas, coal, imports) |
| `weather` | 70,080 | region × hour |
| `air_stations` | 12 | station |
| `air_quality` | 105,120 | station × hour |
| `transport_routes` | 21 | 9 ferry routes, 12 rail lines |
| `ridership` | 135,626 | route × service hour (ferries 06–22, rail 05–23) |
| `harbour_calls` | ≈45,000 | vessel call at the five commercial ports |
| `municipal_budget_lines` | 5,760 | fiscal year 2021–2025 × municipality × 24 line items |
| `municipal_budget_totals` | 240 | fiscal year × municipality, as reported |
| `household_survey` | 30,000 | household (2025 survey, weighted) |
| `bank_branches` | 24 | branch of Corvane Savings Bank (fictional) |
| `card_spend` | 105,120 | day × branch catchment × 12 merchant categories |

The exact counts and column types are in `catalog.json`. In
`household_survey`, the columns `household_id`, `monthly_income_mdc` and
`respondent_age` are restricted by default. They may only be aggregated.

`REGIONS` also carries a drawable map. It has eight polygons on a 1000 × 700
canvas (y points down) that tile one country, and neighbouring regions share
edges. The west border is land and the other sides are coast. Velmora and
Durrany are inland.

## Planted structure

Each event is in `STORY` (`story.ts`) with its dates, regions and expected
effect size. `data.test.ts` measures every effect from the rows.

1. **`heatwave`, 10–16 Feb.** It hits the three northern regions (KES, ARV,
   TAM). Temperatures run 8–11 °C above normal. Their daily peak load rises
   about 25% over the rest of February, and the year's national peak hour falls
   inside the heatwave. Ozone and PM2.5 rise, hydro falls to about 60%, and gas
   runs more than 20% higher. The annual survey's energy spend does not show it.
2. **`ferry-strike`, 14–16 May.** Every ferry hour is cancelled with 0
   boardings. The four rail lines that run beside a ferry route (RL-02, RL-03,
   RL-07, RL-08) carry 30–40% more. `transport` card spend at coastal branches
   falls about 35%, and fuel rises about 12%. No ferry calls at any port.
3. **`budget-gap`, Velmora, FY 2023–2025.** In each of Velmora's six
   municipalities, `reported_actual_mdc` is 3–9% higher than the sum of its
   lines. Everywhere else the totals equal the line sums exactly.
   (`reported_budget_mdc` always reconciles.)
4. **`storm`, 12–13 Aug.** Winds reach 20–29 m/s and 55–95 mm of rain falls
   per day in Haldenmouth, with smaller amounts in Saltmere and Fennory Shore.
   Port Halden takes no arrivals and no departures from 12 Aug 00:00 to
   14 Aug 00:00. Vessels in port wait, and the delayed arrivals land over the
   next three days. Ferries in the three storm regions are cancelled. Card
   spend in Haldenmouth dips during the storm (online goes up), then catches
   up. Emergency management spending in FY 2025 runs over budget in the storm
   regions.
5. **`new-rail`, 1 July.** The Saltmere Crosslink (RL-12, Brennick to Port
   Halden) opens and ramps up over three weeks. Its ridership rows start on the
   day it opens. It takes about a third of the Saltmere Ferry's (FR-04)
   weekday riders, measured against the other ferries.
6. **Ordinary structure:**
   - Daily and weekly cycles and the seasons.
   - The public holidays in `STORY.holidays`.
   - Wind and solar output follow `weather`, and hydro follows the season and
     recent rain.
   - Air quality follows traffic, wind, rain, sun and winter heating.
   - Ferry use has summer peaks and drops with rain and wind.
   - Income differs by region, tenure, household size and age.
   - Survey weights correct for private renters responding less often.
   - Card spend has weekday patterns, paydays (the 15th and the last day of the
     month), holidays and a December peak.

## Bring-your-own samples

These live in `public/canvas/samples/`. They are generated by `samples.ts`, are
not in the Catalog, and are fictional SPECIMEN data like the rest. The CSVs
carry no marker in the body, so that they stay plain CSV. This README is their
SPECIMEN notice.

- `market-stall-sales.csv` holds daily sales of 13 stalls at the Aurel
  Riverside Market, which is closed on Mondays. Columns: `date`, `stall`,
  `category`, `units`, `revenue_mdc`, `rain_mm`. Rain keeps people away,
  weekends and December are busy, ice cream follows summer, and the soap stall
  joins on 1 June.
- `bike-share-trips.csv` holds individual Halden Bikes trips in Port Halden,
  March–April 2025. Columns: `trip_id`, `started_at`, `ended_at`,
  `start_station`, `end_station`, `duration_min`, `distance_km`, `member_type`,
  `bike_type`. Commuter peaks fall on working days. Casual riders and round
  trips are more common at weekends, rainy days are quiet, and electric bikes
  are faster.
