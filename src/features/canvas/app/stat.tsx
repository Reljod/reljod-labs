/** @jsxImportSource preact */
import { formatDelta, formatValue, MISSING, toNumber } from "./format";
import { column } from "./model";
import { type ChartProps, Empty } from "./plot";

/** Stat tiles: when the answer is a number, the number is the chart. */
export function StatView({ view, encoding }: ChartProps<"stat">) {
  const row = view.result.rows[0];
  if (!row) return <Empty>The Query returned no rows.</Empty>;
  return (
    <div class="tiles">
      {encoding.tiles.map((tile) => {
        const cell = row[column(view.result, tile.field)];
        // The figure leads; its unit rides beside it, smaller.
        const attached = /^[%°]/.test(tile.unit ?? "");
        const text = formatValue(
          cell,
          {
            format: tile.format === "currency" ? "number" : tile.format,
            unit: attached ? tile.unit : undefined,
          },
          { compact: true },
        );
        const shown = text;
        const unit =
          tile.format === "currency"
            ? tile.unit || "MDC"
            : tile.format === "percent" || attached
              ? ""
              : tile.unit;
        const change = tile.delta
          ? toNumber(row[column(view.result, tile.delta.field)])
          : null;
        const good =
          change === null || change === 0
            ? null
            : change > 0 === (tile.delta?.upIsGood ?? true);
        return (
          <div class="tile" key={tile.field}>
            <p class="eyebrow">{tile.label}</p>
            <p class="value">
              {shown}
              {unit && text !== MISSING ? <small>{unit}</small> : null}
            </p>
            {change !== null ? (
              <p
                class={`delta ${good === null ? "flat" : good ? "ok" : "no"}`}
              >
                <span aria-hidden="true">
                  {change > 0 ? "▲" : change < 0 ? "▼" : "■"}
                </span>
                {formatDelta(change, {
                  format: tile.delta?.format,
                  unit: tile.delta?.format ? undefined : tile.unit,
                })}
                <span class="sr">
                  {change === 0
                    ? "no change"
                    : `${change > 0 ? "up" : "down"}, ${good ? "good" : "bad"}`}
                </span>
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
