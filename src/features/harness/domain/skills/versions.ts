import type { RuleSpec, RuleState } from "../rules";
import { defaultRuleState, isDefaultState } from "../rules";

/**
 * Version arithmetic shared by Skills and Rules (ADR 0015). History is never
 * rewritten: every save and every restore adds a Version, and the latest
 * Version is the state in force. No Version at all means the Default.
 */

/** The Version a save takes: one more than the highest so far. */
export function nextVersion(versions: readonly number[]): number {
  return versions.reduce((top, version) => Math.max(top, version), 0) + 1;
}

/** The latest of a list of saved Versions, or null while the Default applies. */
export function latestOf<T extends { version: number }>(
  versions: readonly T[],
): T | null {
  let latest: T | null = null;
  for (const item of versions) {
    if (!latest || item.version > latest.version) latest = item;
  }
  return latest;
}

export type RestorePlan<T> = {
  /** The state to save as the new Version. */
  state: T;
  /** `null` for the Default, else the Version put back. */
  from: number | null;
  /** The note the new Version carries. */
  note: string;
};

/**
 * What a restore saves: the Default (`version` left out or 0), or a copy of an
 * earlier Version. Either way it is a new Version. Null when the Version asked
 * for was never saved.
 */
export function planRestore<T>(
  base: T,
  saved: readonly (T & { version: number })[],
  version?: number | null,
): RestorePlan<T> | null {
  if (!version) {
    return { state: base, from: null, note: "Restored the Default" };
  }
  const found = saved.find((item) => item.version === version);
  if (!found) return null;
  return { state: found, from: version, note: `Restored Version ${version}` };
}

/** The Rule state in force: the latest saved Version laid over the spec, or the Default (Version 0). */
export function resolveRuleState(
  spec: RuleSpec,
  latest: (Omit<RuleState, "version"> & { version: number }) | null,
): RuleState {
  if (!latest) return defaultRuleState(spec);
  const base = defaultRuleState(spec);
  const params = { ...base.params };
  // Only Parameters the spec still has; a saved value the spec dropped is ignored.
  for (const name of Object.keys(spec.params)) {
    const value = latest.params[name];
    if (value !== undefined) params[name] = value;
  }
  return {
    version: latest.version,
    enabled: latest.enabled,
    params,
    outcome: latest.outcome,
    effectiveFrom: latest.effectiveFrom,
  };
}

/**
 * The Rule state in force on `asOf` (`YYYY-MM-DD`): the highest saved Version
 * whose effective date is on or before `asOf`; else the Default (Version 0).
 * Null only when even the Default takes effect after `asOf`: the Rule is not
 * yet in force. A Version dated in the future is a scheduled change, so it
 * does not displace the Version in force before its date. A switched-off
 * Version in force is returned as it is (the caller skips it).
 */
export function resolveRuleAsOf(
  spec: RuleSpec,
  versions: readonly (Omit<RuleState, "version"> & { version: number })[],
  asOf: string,
): RuleState | null {
  let found: (Omit<RuleState, "version"> & { version: number }) | null = null;
  for (const item of versions) {
    if (item.effectiveFrom > asOf) continue;
    if (!found || item.version > found.version) found = item;
  }
  if (found) return resolveRuleState(spec, found);
  const base = defaultRuleState(spec);
  return base.effectiveFrom > asOf ? null : base;
}

/**
 * The next change to the Rule a Run will see after `asOf`: the state in force
 * on the first later date on which the Version in force changes, or null when
 * none is scheduled. Versions are walked by date because the highest Version
 * already in effect wins (`resolveRuleAsOf`): a Version saved later with an
 * earlier date replaces an earlier-saved future one, which then never
 * applies, and a future Version below the one in force never applies either.
 */
export function nextScheduledRuleState(
  spec: RuleSpec,
  versions: readonly (Omit<RuleState, "version"> & { version: number })[],
  asOf: string,
): RuleState | null {
  const current = resolveRuleAsOf(spec, versions, asOf);
  const dates = [
    ...new Set(
      [spec.effectiveFrom, ...versions.map((item) => item.effectiveFrom)]
        .filter((date) => date > asOf)
        .sort(),
    ),
  ];
  for (const date of dates) {
    const then = resolveRuleAsOf(spec, versions, date);
    if (then && then.version !== current?.version) return then;
  }
  return null;
}

/** Whether two states of a Rule say the same thing, whatever their Versions. */
export function sameRuleState(
  spec: RuleSpec,
  a: Omit<RuleState, "version">,
  b: Omit<RuleState, "version">,
): boolean {
  return (
    a.enabled === b.enabled &&
    a.outcome === b.outcome &&
    a.effectiveFrom === b.effectiveFrom &&
    Object.keys(spec.params).every((name) => {
      const left = a.params[name];
      const right = b.params[name];
      if (Array.isArray(left) && Array.isArray(right)) {
        return (
          left.length === right.length &&
          left.every((item, index) => item === right[index])
        );
      }
      return left === right;
    })
  );
}

/** The Parameters that differ between two states: name → [before, after]. */
export function changedParams(
  spec: RuleSpec,
  before: RuleState["params"],
  after: RuleState["params"],
): Record<string, [unknown, unknown]> {
  const changed: Record<string, [unknown, unknown]> = {};
  for (const name of Object.keys(spec.params)) {
    const a = before[name];
    const b = after[name];
    const same =
      Array.isArray(a) && Array.isArray(b)
        ? a.length === b.length && a.every((item, index) => item === b[index])
        : a === b;
    if (!same) changed[name] = [a ?? null, b ?? null];
  }
  return changed;
}

export { isDefaultState };
