/**
 * What reading one Document with the model cost: the model that answered,
 * the provider that served it, its tokens and the price the gateway reported.
 * Any part the gateway did not report is null, never a guess.
 */
export type ReadUsage = {
  model: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: number | null;
};

/** A Document's read usage plus how long its parse and read stages took. */
export type DocumentMetrics = ReadUsage & {
  parseMs: number | null;
  readMs: number | null;
};

export type RunTotals = {
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  models: string[];
  providers: string[];
};

const sum = (values: (number | null)[]) =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

/** Adds up a run's Documents; the cost is null only when none reported one. */
export function runTotals(metrics: (ReadUsage | null)[]): RunTotals {
  const known = metrics.filter((item): item is ReadUsage => item !== null);
  const costs = known.map((item) => item.costUsd);
  const unique = (values: (string | null)[]) => [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
  return {
    costUsd: costs.some((cost) => cost !== null) ? sum(costs) : null,
    inputTokens: sum(known.map((item) => item.inputTokens)),
    outputTokens: sum(known.map((item) => item.outputTokens)),
    reasoningTokens: sum(known.map((item) => item.reasoningTokens)),
    models: unique(known.map((item) => item.model)),
    providers: unique(known.map((item) => item.provider)),
  };
}

/** Dollars with enough places to show a fraction of a cent. */
export function formatUsd(value: number | null) {
  if (value === null) return "-";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

export function formatTokens(value: number | null) {
  if (value === null) return "-";
  return value >= 10_000
    ? `${(value / 1000).toFixed(1)}k`
    : value.toLocaleString("en-US");
}

export function formatMs(value: number | null) {
  if (value === null) return "-";
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

export const formatPercent = (value: number | null) =>
  value === null ? "-" : `${Math.round(value * 100)}%`;

/** Reads a number the gateway may send as a number or a decimal string. */
export function asNumber(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : null;
}
