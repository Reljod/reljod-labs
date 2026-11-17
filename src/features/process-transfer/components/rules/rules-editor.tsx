"use client";

import { useState } from "react";
import { RULE_GROUPS, type Rule, type RuleGroup } from "../../domain/rules";
import { resetRules } from "../../server/actions";
import { ConfirmDialog } from "../confirm-dialog";
import { plural } from "../format";
import { quietButtonClass } from "../ui";
import { RuleCard, type SavedRules } from "./rule-card";

/**
 * The Owner's Rules, grouped as the pipeline applies them. A Run keeps the
 * Rules it started with; a Redo applies the ones saved here now.
 */
export function RulesEditor({
  rules,
  rulesVersion,
  onSaved,
}: {
  rules: Rule[];
  rulesVersion: number;
  onSaved: (saved: Omit<SavedRules, "ok">) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [opened, setOpened] = useState(0);
  const edited = rules.filter((rule) => rule.edited).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow text-ink-muted">
            Rules · version {rulesVersion}
          </p>
          <h2 className="font-mono text-lg font-bold tracking-[0.04em] uppercase">
            What the Process and the Deck must satisfy
          </h2>
          <p className="mt-2 text-sm">
            Every Check is one of these Rules. Change a number, switch a Rule
            off, or let it warn instead of block. A Run uses the Rules as they
            were when it started;{" "}
            <span className="font-semibold">Redo deck</span> on a finished Run
            applies the ones saved here now.
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 lg:items-end">
          <button
            type="button"
            onClick={() => {
              setOpened((count) => count + 1);
              setConfirming(true);
            }}
            disabled={edited === 0}
            className={`${quietButtonClass} text-seal-red`}
          >
            Reset all Rules
          </button>
          <p className="text-xs text-ink-muted">
            {edited === 0
              ? "All Rules are at their defaults."
              : `${plural(edited, "Rule")} changed from the default.`}
          </p>
        </div>
      </div>

      {(Object.keys(RULE_GROUPS) as RuleGroup[]).map((group) => {
        const inGroup = rules.filter((rule) => rule.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section
            key={group}
            aria-labelledby={`rules-${group}`}
            className="flex flex-col gap-3"
          >
            <div>
              <h3
                id={`rules-${group}`}
                className="font-mono text-sm font-bold tracking-[0.08em] uppercase"
              >
                {RULE_GROUPS[group].label}
              </h3>
              <p className="text-sm text-ink-muted">
                {RULE_GROUPS[group].hint}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {inGroup.map((rule) => (
                <RuleCard key={rule.id} rule={rule} onSaved={onSaved} />
              ))}
            </div>
          </section>
        );
      })}

      {confirming ? (
        <ConfirmDialog
          key={opened}
          id="ho-reset-rules"
          title="Reset all Rules"
          confirm="Reset all"
          pending="Resetting…"
          danger
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const result = await resetRules();
            if (!result.ok) return { error: result.error };
            onSaved(result);
            return {
              done: `Every Rule is back to its default. Rules are now version ${result.rulesVersion}.`,
            };
          }}
        >
          {plural(edited, "Rule")} you changed go back to the default. Runs
          already made keep the Rules they used.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
