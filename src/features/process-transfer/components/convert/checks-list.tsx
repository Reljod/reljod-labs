"use client";

import {
  type CheckResult,
  type ReviewFinding,
  RULE_GROUPS,
  type Rule,
  type RuleGroup,
} from "../../domain/rules";
import { plural } from "../format";
import { linkButtonClass, StatusMark } from "../ui";

type Target = {
  /** "Step 4" or "Slide 3" for a target id, or null when it names nothing on screen. */
  name: (target: string | null) => string | null;
  /** Shows what the target points at (scrolls to the Step, jumps the player). */
  go: (target: string) => void;
};

function checkTone(check: CheckResult) {
  if (check.passed) return "pass" as const;
  return check.severity === "block" ? ("fail" as const) : ("warn" as const);
}

/** "11 of 13 passed · 1 blocking · 1 warning". */
export function checksLine(checks: CheckResult[]): string {
  const failed = checks.filter((check) => !check.passed);
  const blockingCount = failed.filter(
    (check) => check.severity === "block",
  ).length;
  const parts = [`${checks.length - failed.length} of ${checks.length} passed`];
  if (blockingCount > 0) parts.push(`${blockingCount} blocking`);
  if (failed.length - blockingCount > 0)
    parts.push(plural(failed.length - blockingCount, "warning"));
  return parts.join(" · ");
}

/**
 * Checks grouped by Rule group, failures first, each failure naming the Step
 * or slide it is about. Clicking that name shows it.
 */
export function ChecksList({
  checks,
  rules,
  target,
  empty = "No Checks have run yet.",
}: {
  checks: CheckResult[];
  rules: Rule[];
  target: Target;
  /** What to say when there are no Checks. */
  empty?: string;
}) {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const groups = (Object.keys(RULE_GROUPS) as RuleGroup[])
    .map((group) => ({
      group,
      checks: checks
        .filter(
          (check) =>
            (byId.get(check.ruleId)?.group ?? check.ruleId.split(".")[0]) ===
            group,
        )
        .sort((a, b) => Number(a.passed) - Number(b.passed)),
    }))
    .filter((entry) => entry.checks.length > 0);
  const known = new Set(groups.flatMap((entry) => entry.checks));
  const other = checks.filter((check) => !known.has(check));

  if (checks.length === 0) {
    return <p className="text-sm text-ink-muted">{empty}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {[
        ...groups,
        ...(other.length > 0 ? [{ group: null, checks: other }] : []),
      ].map((entry) => (
        <section key={entry.group ?? "other"} className="flex flex-col gap-1.5">
          <h4 className="eyebrow flex flex-wrap items-baseline gap-x-2 text-ink-muted">
            <span className="font-bold text-ink">
              {entry.group ? RULE_GROUPS[entry.group].label : "Other"}
            </span>
            <span>{checksLine(entry.checks)}</span>
          </h4>
          {entry.checks.some((check) => !check.passed) ? (
            <ul className="flex flex-col divide-y divide-ink/10 rounded-sm border border-ink/20 bg-paper">
              {entry.checks
                .filter((check) => !check.passed)
                .map((check) => (
                  <CheckRow
                    key={check.ruleId}
                    check={check}
                    title={byId.get(check.ruleId)?.title ?? check.ruleId}
                    target={target}
                  />
                ))}
            </ul>
          ) : null}
          {/* Passed Checks are a compact list of names: the failures are what a reader needs to see first. */}
          <ul aria-label="Passed" className="flex flex-wrap gap-1.5">
            {entry.checks
              .filter((check) => check.passed)
              .map((check) => (
                <li
                  key={check.ruleId}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-ivy/40 bg-ivy/5 py-0.5 pr-2 pl-1 text-xs"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-4 items-center justify-center rounded-sm bg-ivy font-bold text-[10px] text-paper"
                  >
                    ✓
                  </span>
                  <span className="sr-only">Passed: </span>
                  {byId.get(check.ruleId)?.title ?? check.ruleId}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CheckRow({
  check,
  title,
  target,
}: {
  check: CheckResult;
  title: string;
  target: Target;
}) {
  const tone = checkTone(check);
  return (
    <li
      className={`flex gap-2.5 px-3 py-2 ${check.passed ? "" : tone === "fail" ? "bg-seal-red/5" : "bg-brass/10"}`}
    >
      <StatusMark tone={tone} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold">{title}</span>
          {check.passed ? null : (
            <span
              className={`font-mono text-[10px] font-bold tracking-[0.08em] uppercase ${check.severity === "block" ? "text-seal-red" : "text-oak"}`}
            >
              {check.severity === "block" ? "Blocks approval" : "Warning only"}
            </span>
          )}
        </p>
        {check.summary && !check.passed ? (
          <p className="text-sm text-ink-muted">{check.summary}</p>
        ) : null}
        {check.failures.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {check.failures.map((failure, index) => {
              const name = target.name(failure.target);
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: failures carry no id and never reorder
                  key={index}
                  className="flex gap-1.5"
                >
                  <span aria-hidden="true" className="text-ink-muted">
                    –
                  </span>
                  <span className="min-w-0">
                    {name && failure.target ? (
                      <button
                        type="button"
                        onClick={() =>
                          failure.target && target.go(failure.target)
                        }
                        className={`${linkButtonClass} mr-1 font-mono text-xs`}
                      >
                        {name}
                      </button>
                    ) : null}
                    {failure.message}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/** What a reviewer model raised: major or minor, the issue and the change to make. */
export function FindingsList({
  findings,
  target,
  empty = "The reviewer raised nothing.",
}: {
  findings: ReviewFinding[];
  target: Target;
  empty?: string;
}) {
  if (findings.length === 0) {
    return <p className="text-sm text-ink-muted">{empty}</p>;
  }
  const sorted = [...findings].sort(
    (a, b) => Number(a.severity === "minor") - Number(b.severity === "minor"),
  );
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((finding, index) => {
        const name = target.name(finding.target);
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: findings carry no id
            key={index}
            className={`rounded-sm border-l-4 bg-paper px-3 py-2 text-sm ${finding.severity === "major" ? "border-seal-red" : "border-brass"}`}
          >
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span
                className={`font-mono text-[10px] font-bold tracking-[0.08em] uppercase ${finding.severity === "major" ? "text-seal-red" : "text-oak"}`}
              >
                {finding.severity}
              </span>
              {name && finding.target ? (
                <button
                  type="button"
                  onClick={() => finding.target && target.go(finding.target)}
                  className={`${linkButtonClass} font-mono text-xs`}
                >
                  {name}
                </button>
              ) : null}
            </p>
            <p className="mt-0.5">{finding.issue}</p>
            <p className="mt-0.5 text-ink-muted">
              <span className="font-semibold text-ink">Change: </span>
              {finding.fix}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
