/** @jsxImportSource preact */
import { useMemo, useState } from "preact/hooks";
import type { Format, QueryResult } from "../domain/view";
import { CATEGORICAL, type Theme } from "./colors";
import { formatValue, toNumber } from "./format";
import { column, sortRows } from "./model";
import { type Act, type ChartProps, Empty } from "./plot";

/** The table kind, and the rows behind any View in Show the work. */

const PAGE = 200;

export type TableColumn = {
  field: string;
  label?: string;
  format?: Format;
  unit?: string;
  bar?: boolean;
};

const NUMERIC: readonly (Format | undefined)[] = [
  "number",
  "integer",
  "compact",
  "percent",
  "currency",
];

export function DataTable({
  result,
  columns,
  sort: firstSort,
  drill,
  act,
  theme,
  page = PAGE,
}: {
  result: QueryResult;
  columns: TableColumn[];
  sort?: { field: string; descending?: boolean };
  drill?: { param: string; field: string };
  act?: Act;
  theme: Theme;
  page?: number;
}) {
  const [sort, setSort] = useState(firstSort ?? null);
  const [shown, setShown] = useState(page);
  const shape = useMemo(
    () =>
      columns.map((item) => {
        const at = column(result, item.field);
        const numeric =
          at >= 0 &&
          (NUMERIC.includes(item.format) ||
            (!item.format &&
              result.rows.some((row) => typeof row[at] === "number") &&
              result.rows.every(
                (row) => row[at] === null || typeof row[at] === "number",
              )));
        let reach = 0;
        if (item.bar && at >= 0)
          for (const row of result.rows)
            reach = Math.max(reach, Math.abs(toNumber(row[at]) ?? 0));
        return { ...item, at, numeric, reach };
      }),
    [columns, result],
  );
  const rows = useMemo(() => {
    const at = sort ? column(result, sort.field) : -1;
    return at < 0 ? result.rows : sortRows(result.rows, at, !!sort?.descending);
  }, [result, sort]);
  if (result.rows.length === 0)
    return <Empty>The Query returned no rows.</Empty>;

  const drillAt = drill ? column(result, drill.field) : -1;
  const canDrill = !!drill && drillAt >= 0 && !!act?.enabled;
  const chosen = drill ? act?.values[drill.param] : undefined;
  const visible = rows.slice(0, shown);
  const pick = (value: unknown) => {
    if (!drill || !act || value === null || value === undefined) return;
    const param = act.defaults[drill.param];
    act.set({
      [drill.param]:
        typeof param === "number"
          ? (toNumber(value as string) ?? 0)
          : String(value),
    });
  };

  return (
    <>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              {shape.map((item) => {
                const sorted = sort?.field === item.field;
                return (
                  <th
                    key={item.field}
                    class={item.numeric ? "num" : undefined}
                    scope="col"
                    aria-sort={
                      sorted
                        ? sort?.descending
                          ? "descending"
                          : "ascending"
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort({
                          field: item.field,
                          descending: sorted ? !sort?.descending : item.numeric,
                        })
                      }
                    >
                      {item.label || item.field.replace(/_/g, " ")}
                      <span aria-hidden="true">
                        {sorted ? (sort?.descending ? "▼" : "▲") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const value = drillAt >= 0 ? row[drillAt] : null;
              const on =
                drill &&
                chosen !== undefined &&
                String(value) === String(chosen);
              return (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own.
                  key={index}
                  class={`${canDrill ? "drill" : ""}${on ? " on" : ""}`}
                  tabIndex={canDrill ? 0 : undefined}
                  aria-selected={canDrill ? !!on : undefined}
                  onClick={canDrill ? () => pick(value) : undefined}
                  onKeyDown={
                    canDrill
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            pick(value);
                          }
                        }
                      : undefined
                  }
                >
                  {shape.map((item) => {
                    const cell = item.at < 0 ? null : row[item.at];
                    const text = formatValue(cell, item);
                    if (!item.bar || item.reach === 0)
                      return (
                        <td
                          key={item.field}
                          class={item.numeric ? "num" : undefined}
                        >
                          {text}
                        </td>
                      );
                    const share = Math.abs(toNumber(cell) ?? 0) / item.reach;
                    return (
                      <td key={item.field} class="num bar-cell">
                        <i
                          style={{
                            width: `calc(${(share * 100).toFixed(1)}% - 20px)`,
                            background: CATEGORICAL[theme][0],
                          }}
                        />
                        <span>{text}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown ? (
        <div class="more">
          <button
            type="button"
            class="btn"
            onClick={() => setShown(shown + page)}
          >
            Show more
          </button>
          <span class="note">
            {shown.toLocaleString("en-US")} of{" "}
            {rows.length.toLocaleString("en-US")} rows
          </span>
        </div>
      ) : null}
    </>
  );
}

export function TableView({ view, encoding, act, theme }: ChartProps<"table">) {
  return (
    <DataTable
      result={view.result}
      columns={encoding.columns}
      sort={encoding.sort}
      drill={encoding.drill}
      act={act}
      theme={theme}
    />
  );
}

/** Every column of a result, as it came: the table twin of any chart. */
export function RowsTable({
  result,
  theme,
}: {
  result: QueryResult;
  theme: Theme;
}) {
  const columns = useMemo(
    () =>
      result.columns.map((item) => ({
        field: item.name,
        format: (/date|time/.test(item.type) ? "datetime" : undefined) as
          | Format
          | undefined,
      })),
    [result],
  );
  return (
    <DataTable result={result} columns={columns} theme={theme} page={50} />
  );
}
