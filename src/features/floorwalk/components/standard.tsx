"use client";

import { motion } from "motion/react";
import { cx, Panel } from "@/features/harness/components/ui";
import {
  rulesFor,
  SEVERITIES,
  SEVERITY_WEIGHT,
  type SiteKind,
  type Standard,
} from "../domain/rules";
import { CHECKS, type Scored } from "../domain/walk";
import { SEVERITY_COLOR, SEVERITY_LABEL } from "./look";

/**
 * The Standard: every Rule, on or off, and how much it weighs. Changing it
 * re-scores the open Walk at once, with no model call: the model only
 * reports; the Standard decides.
 */
export function StandardTab({
  standard,
  onChange,
  onReset,
  scored,
  hasWalk,
  kind,
}: {
  standard: Standard;
  onChange: (next: Standard) => void;
  onReset: () => void;
  scored: Scored | null;
  hasWalk: boolean;
  /** The open Site's kind: only its Rules are listed. Null lists them all. */
  kind: SiteKind | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Panel
        title="The Standard"
        eyebrow="Rules are data"
        bodyClassName=""
        actions={
          <button
            type="button"
            onClick={onReset}
            className="press rounded-sm border-2 border-ink bg-paper px-2 py-1 font-mono text-[11px] font-bold uppercase"
          >
            Reset
          </button>
        }
      >
        <ul className="divide-y-2 divide-ink/10">
          {rulesFor(kind).map((rule) => {
            const setting = standard[rule.id] ?? {
              on: true,
              severity: rule.severity,
            };
            const hits = scored
              ? [
                  ...scored.counted
                    .filter((c) => c.rule.id === rule.id)
                    .map(() => 1),
                  ...scored.ignored
                    .filter((f) => f.rule === rule.id)
                    .map(() => 1),
                ].length
              : 0;
            return (
              <li
                key={rule.id}
                className={cx(
                  "grid gap-3 px-4 py-3 sm:grid-cols-[auto_1fr_auto]",
                  !setting.on && "opacity-55",
                )}
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={setting.on}
                    onChange={(e) =>
                      onChange({
                        ...standard,
                        [rule.id]: { ...setting, on: e.target.checked },
                      })
                    }
                    className="h-5 w-5 accent-[#1d4e89]"
                    aria-label={`${rule.title} is on`}
                  />
                </label>
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold uppercase tracking-[0.06em]">
                    {rule.title}
                    <span className="ml-2 font-normal text-ink-muted normal-case">
                      {rule.id}
                    </span>
                    {hits ? (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="ml-2 rounded-sm bg-ink px-1.5 py-0.5 text-[10px] text-paper"
                      >
                        {hits} in this Walk
                      </motion.span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-sm">{rule.sentence}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-ink-muted uppercase">
                    Fix{" "}
                    {rule.fixWithinHours === 0
                      ? "at once"
                      : `within ${rule.fixWithinHours} h`}{" "}
                    · {rule.kinds.join(", ")}
                  </p>
                </div>
                <fieldset className="flex items-start gap-1">
                  <legend className="sr-only">{`${rule.title} severity`}</legend>
                  {SEVERITIES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={setting.severity === s}
                      disabled={!setting.on}
                      onClick={() =>
                        onChange({
                          ...standard,
                          [rule.id]: { ...setting, severity: s },
                        })
                      }
                      className={cx(
                        "rounded-sm border-2 border-ink px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase",
                        setting.severity === s
                          ? "text-paper shadow-hard-sm"
                          : "bg-paper text-ink-muted",
                      )}
                      style={
                        setting.severity === s
                          ? { background: SEVERITY_COLOR[s] }
                          : undefined
                      }
                    >
                      {SEVERITY_LABEL[s]}
                    </button>
                  ))}
                </fieldset>
              </li>
            );
          })}
        </ul>
      </Panel>
      <div className="space-y-4">
        <Panel
          title="Re-scored, not re-watched"
          eyebrow="The open Walk"
          bodyClassName="p-4"
        >
          {hasWalk && scored ? (
            <div>
              <motion.p
                key={scored.score}
                initial={{ scale: 1.3, color: "#1d4e89" }}
                animate={{ scale: 1, color: "#14213d" }}
                className="font-mono text-5xl font-black tabular-nums"
              >
                {scored.score}
              </motion.p>
              <p className="eyebrow mt-1 text-[10px] text-ink-muted">
                {scored.band.label}
              </p>
              <p className="mt-3 text-sm">
                {scored.counted.length} Findings count; {scored.ignored.length}{" "}
                sit under a Rule you switched off. No model was called to change
                this.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Walk a Sample first, then change a Rule here and watch its Score
              move.
            </p>
          )}
        </Panel>
        <Panel
          title="The checks"
          eyebrow="Code, not the model"
          bodyClassName="p-4 text-sm space-y-1.5"
        >
          <p>
            A Sighting becomes a Finding only if it cites a Rule of the
            Standard, points at a second inside the footage, draws a box of at
            least {(CHECKS.minBoxArea * 100).toFixed(2)}% of the frame and is at
            least {Math.round(CHECKS.confidenceFloor * 100)}% sure.
          </p>
          <p>
            Two Sightings of one Rule within {CHECKS.mergeSeconds} s that
            overlap, or in the same zone within {CHECKS.sameZoneSeconds} s, are
            one Finding.
          </p>
          <p>
            The Score is 100 less {SEVERITY_WEIGHT.critical} per critical,{" "}
            {SEVERITY_WEIGHT.major} per major and {SEVERITY_WEIGHT.minor} per
            minor Finding.
          </p>
        </Panel>
      </div>
    </div>
  );
}
