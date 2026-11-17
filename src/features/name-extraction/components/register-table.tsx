"use client";

import { Fragment, useMemo, useState } from "react";
import type { EntityType, ExtractedName, Finder } from "../domain/contract";
import { downloadText, fileStem, namesCsv, pagesOf, percent } from "./format";
import { Button, cx, fieldClass, Panel, Tag } from "./ui";

const FINDER_TONE: Record<Finder, "neutral" | "blue" | "brass" | "ink"> = {
  sweep: "neutral",
  reader: "blue",
  code: "brass",
  analyst: "ink",
};

type Sort = "pages" | "mentions" | "confidence" | "name";

/** The Register: every Name with its aliases, roles, pages and who found it. */
export function RegisterTable({
  names,
  reviewBelow,
  title,
}: {
  names: ExtractedName[];
  /** The Rulebook's threshold: below it a Name is flagged "in doubt". */
  reviewBelow: number;
  title: string;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<EntityType | "all">("all");
  const [doubtOnly, setDoubtOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("pages");
  /** The open page of a Name: "<canonical>#<page>". */
  const [open, setOpen] = useState<string | null>(null);

  const doubtful = names.filter((name) => name.confidence < reviewBelow).length;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = names.filter(
      (name) =>
        (type === "all" || name.type === type) &&
        (!doubtOnly || name.confidence < reviewBelow) &&
        (!needle ||
          name.canonical.toLowerCase().includes(needle) ||
          name.aliases.some((alias) => alias.toLowerCase().includes(needle))),
    );
    const first = (name: ExtractedName) => pagesOf(name)[0] ?? 0;
    return rows.sort((a, b) => {
      if (sort === "mentions") return b.mentions.length - a.mentions.length;
      if (sort === "confidence") return a.confidence - b.confidence;
      if (sort === "name") return a.canonical.localeCompare(b.canonical);
      return first(a) - first(b) || a.canonical.localeCompare(b.canonical);
    });
  }, [names, query, type, doubtOnly, sort, reviewBelow]);

  return (
    <Panel
      eyebrow="Register"
      title={`${names.length} names · ${doubtful} in doubt`}
      actions={
        <Button
          size="sm"
          disabled={names.length === 0}
          onClick={() =>
            downloadText(
              namesCsv(shown, reviewBelow),
              `sieve-${fileStem(title)}.csv`,
              "text/csv;charset=utf-8",
            )
          }
        >
          Export CSV
        </Button>
      }
      bodyClassName=""
    >
      <div className="flex flex-wrap items-center gap-2 border-ink/10 border-b px-4 py-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search names and aliases"
          aria-label="Search names and aliases"
          className={cx(fieldClass, "h-8 w-full sm:w-64")}
        />
        <select
          aria-label="Type"
          value={type}
          onChange={(event) =>
            setType(event.target.value as EntityType | "all")
          }
          className={cx(fieldClass, "h-8 text-xs")}
        >
          <option value="all">People and organizations</option>
          <option value="person">People</option>
          <option value="organization">Organizations</option>
        </select>
        <select
          aria-label="Sort"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
          className={cx(fieldClass, "h-8 text-xs")}
        >
          <option value="pages">First page</option>
          <option value="mentions">Most mentions</option>
          <option value="confidence">Least confident</option>
          <option value="name">A–Z</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={doubtOnly}
            onChange={(event) => setDoubtOnly(event.target.checked)}
          />
          In doubt only (below {percent(reviewBelow)})
        </label>
        <span className="ml-auto font-mono text-xs text-ink-muted">
          {shown.length} shown
        </span>
      </div>
      <div className="sv-scroll max-h-[36rem] overflow-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="sticky top-0 z-10 bg-paper text-left">
            <tr className="eyebrow text-[0.62rem] text-ink-muted">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Type · roles</th>
              <th className="px-2 py-2 text-right font-medium">Mentions</th>
              <th className="px-2 py-2 font-medium">Pages</th>
              <th className="px-2 py-2 font-medium">Confidence</th>
              <th className="px-4 py-2 font-medium">Found by</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-ink-muted">
                  {names.length === 0
                    ? "No names recorded yet."
                    : "No name matches."}
                </td>
              </tr>
            ) : null}
            {shown.map((name) => {
              const pages = pagesOf(name);
              const inDoubt = name.confidence < reviewBelow;
              const openPage =
                open?.startsWith(`${name.canonical}#`) === true
                  ? Number(open.slice(name.canonical.length + 1))
                  : null;
              return (
                <Fragment key={name.canonical}>
                  <tr
                    className={cx(
                      "border-ink/10 border-t align-top",
                      inDoubt && "bg-brass/10",
                    )}
                  >
                    <td className="px-4 py-2">
                      <p className="font-semibold [overflow-wrap:anywhere]">
                        {name.canonical}
                      </p>
                      {name.aliases.length > 0 ? (
                        <p className="text-xs text-ink-muted [overflow-wrap:anywhere]">
                          aka {name.aliases.join(" · ")}
                        </p>
                      ) : null}
                      {name.note ? (
                        <p className="mt-0.5 text-xs text-oak">{name.note}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex flex-wrap gap-1">
                        <Tag tone={name.type === "person" ? "blue" : "neutral"}>
                          {name.type === "person" ? "person" : "org"}
                        </Tag>
                        {name.roles.map((role) => (
                          <Tag key={role}>{role.replaceAll("_", " ")}</Tag>
                        ))}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {name.mentions.length}
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex max-w-56 flex-wrap gap-1">
                        {pages.map((page) => (
                          <button
                            key={page}
                            type="button"
                            aria-pressed={openPage === page}
                            title={`What page ${page} says`}
                            onClick={() =>
                              setOpen(
                                openPage === page
                                  ? null
                                  : `${name.canonical}#${page}`,
                              )
                            }
                            className={cx(
                              "rounded-sm border px-1 font-mono text-[0.68rem] tabular-nums",
                              openPage === page
                                ? "border-federal-blue bg-federal-blue text-paper"
                                : "border-ink/20 hover:border-federal-blue hover:text-federal-blue",
                            )}
                          >
                            {page}
                          </button>
                        ))}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs tabular-nums">
                        {percent(name.confidence)}
                        {inDoubt ? <Tag tone="brass">in doubt</Tag> : null}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex flex-wrap gap-1">
                        {name.foundBy.map((finder) => (
                          <Tag key={finder} tone={FINDER_TONE[finder]}>
                            {finder}
                          </Tag>
                        ))}
                      </span>
                    </td>
                  </tr>
                  {openPage !== null ? (
                    <tr className="bg-marble/50">
                      <td colSpan={6} className="px-4 py-2">
                        <p className="eyebrow mb-1 text-[0.6rem] text-ink-muted">
                          Page {openPage}, as printed
                        </p>
                        <ul className="flex flex-col gap-0.5 text-sm">
                          {name.mentions
                            .filter((mention) => mention.page === openPage)
                            .map((mention, index) => (
                              <li
                                // biome-ignore lint/suspicious/noArrayIndexKey: the same quote may appear twice on a page
                                key={index}
                                className="font-mono text-xs"
                              >
                                “{mention.quote}”
                              </li>
                            ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
