"use client";

import type { CatalogTableInfo } from "../domain/api";
import { Badge, Panel } from "./ui";

/** The Catalog, and where this fits in a bank. */
export function DataPanel({ catalog }: { catalog: CatalogTableInfo[] }) {
  const rows = catalog.reduce((sum, table) => sum + table.rows, 0);
  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"
      id="cv-panel-data"
    >
      <Panel
        eyebrow={`${catalog.length} Tables · ${rows.toLocaleString("en")} rows · Specimen`}
        title="The Catalog"
        bodyClassName=""
      >
        <ul className="divide-y divide-ink/15">
          {catalog.map((table) => (
            <li key={table.name}>
              <details className="px-4 py-2.5">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold">
                    {table.name}
                  </span>
                  <Badge>{table.group}</Badge>
                  <span className="text-xs text-ink-muted">
                    {table.rows.toLocaleString("en")} rows
                  </span>
                  <span className="basis-full text-sm text-ink-muted sm:basis-auto">
                    {table.title}
                  </span>
                </summary>
                <p className="mt-2 text-sm">{table.description}</p>
                <p className="mt-1 text-xs text-ink-muted">{table.grain}</p>
                <table className="mt-2 w-full text-left text-xs">
                  <tbody>
                    {table.columns.map((column) => (
                      <tr
                        key={column.name}
                        className="border-ink/10 border-t align-top"
                      >
                        <th className="py-1 pr-3 font-mono font-semibold whitespace-nowrap">
                          {column.name}
                        </th>
                        <td className="py-1 pr-3 font-mono text-ink-muted whitespace-nowrap">
                          {column.type}
                          {column.unit ? ` · ${column.unit}` : ""}
                        </td>
                        <td className="py-1">{column.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </li>
          ))}
        </ul>
      </Panel>
      <div className="flex flex-col gap-4">
        <Panel eyebrow="Synthetic" title="About the data">
          <p className="text-sm leading-relaxed">
            Every row is generated from a seed for the fictional Republic of
            Meridia, calendar year 2025. No real country, company or person is
            in it. It has structure worth finding: a heatwave week, a ferry
            strike, a storm, a new rail line, and one region whose budget does
            not add up.
          </p>
        </Panel>
        <Panel eyebrow="In banking" title="Where this fits">
          <p className="text-sm leading-relaxed">
            The same shape answers a relationship manager asking about a book of
            accounts, finance asking why a cost centre is over budget, or risk
            asking which branches moved after an event. The answer is an
            interface a colleague can adjust, the query behind every number is
            on show, code recomputes the narrated numbers before the answer is
            marked verified, and a restricted column (here, household income)
            can only ever be aggregated above a minimum group size, enforced in
            code at the query tool. The{" "}
            <span className="font-mono">card_spend</span> and{" "}
            <span className="font-mono">bank_branches</span> Tables are the
            banking-flavoured part of the Catalog.
          </p>
        </Panel>
      </div>
    </div>
  );
}
