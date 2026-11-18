"use client";

import { useState } from "react";
import { can } from "../../domain/permissions";
import type { RuleGroup } from "../../domain/rules";
import type { RulesView } from "../../domain/views";
import { ListSkeleton, ReadError } from "../operations/figures";
import { RuleCard } from "../rules/rule-card";
import { Badge, cx, segmentClass, segmentsClass } from "../ui";
import { useBank, useRead } from "../use-bank";

const REFUSAL = "Needs a supervisor to edit. Switch Staff.";

/**
 * The Rulebook this bank runs on, grouped. Rules are data: a supervisor edits
 * a Rule's Parameters and saves a new Version; the checks that apply them are
 * code, and only code decides.
 */
export function RulesTab() {
  const { activeStaff } = useBank();
  const read = useRead<RulesView>("list_rules");
  const [group, setGroup] = useState<RuleGroup | "all">("all");
  const canEdit = can(activeStaff, "rule.edit");
  const rules = read.data?.rules ?? [];
  const groups = [...new Set(rules.map((rule) => rule.group))];
  const shown = groups.filter((item) => group === "all" || item === group);
  const edited = rules.filter((rule) => rule.edited).length;

  return (
    <div
      className="tb-scroll min-h-0 flex-1"
      aria-busy={read.isFetching || undefined}
    >
      <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-4">
        <header className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-mono text-lg font-bold tracking-[0.04em] uppercase">
              Rules
            </h2>
            {read.data ? (
              <span className="text-xs text-ink-muted">
                {rules.length} Rules · {edited} edited
              </span>
            ) : null}
          </div>
          <p className="text-sm text-ink-muted">
            Rules are data. The checks that apply them are code; only code
            decides.
          </p>
          {!canEdit ? (
            <p className="outline-box inline-flex items-center gap-2 rounded-sm bg-paper px-2.5 py-1 text-xs">
              <Badge tone="neutral">Read only</Badge>
              {REFUSAL}
            </p>
          ) : null}
          {groups.length > 0 ? (
            <fieldset
              className={cx(segmentsClass, "m-0 min-w-0 border-0 p-0 pt-1")}
            >
              <legend className="sr-only">Show a group of Rules</legend>
              <button
                type="button"
                aria-pressed={group === "all"}
                onClick={() => setGroup("all")}
                className={segmentClass(group === "all")}
              >
                All
              </button>
              {groups.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={group === item}
                  onClick={() => setGroup(item)}
                  className={segmentClass(group === item)}
                >
                  {item}
                </button>
              ))}
            </fieldset>
          ) : null}
        </header>

        {read.isPending ? (
          <ListSkeleton rows={4} height="h-48" label="Reading the Rulebook…" />
        ) : !read.data ? (
          <ReadError error={read.error} onRetry={() => void read.refetch()} />
        ) : (
          shown.map((item) => (
            <section
              key={item}
              className="space-y-3"
              data-testid={`bank-rules-group-${item.toLowerCase().replace(/\W+/g, "-")}`}
            >
              <h3 className="eyebrow border-ink border-b-2 pb-1 text-[0.7rem] font-bold">
                {item}
              </h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {rules
                  .filter((rule) => rule.group === item)
                  .map((rule) => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      canEdit={canEdit}
                      refusal={REFUSAL}
                    />
                  ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
