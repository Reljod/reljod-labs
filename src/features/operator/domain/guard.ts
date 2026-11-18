import type { Change, ScreenCode } from "../legacy/types";
import { isValidContainer } from "./iso6346";
import {
  ACTION_TITLES,
  type ActionKind,
  actionKindOf,
  type FieldCode,
  fieldCodeOf,
} from "./rule-kinds";
import type { Rulebook, RuleId } from "./rules";

/**
 * The Guard: what code decides about one atomic input before HARBOURMASTER
 * takes it. The harness runs the input on a copy of the machine first and
 * hands the Guard what it would do (a Preview): the Screen it would land on
 * and the records it would change. The Guard answers allow, refuse or pause.
 * Pure, so it runs in the Screen sandbox, in the hand-run replay and in tests.
 */

export type Preview = {
  from: ScreenCode;
  to: ScreenCode;
  changes: Change[];
};

/** What the Run has done so far, as far as the Guard needs to know. */
export type GuardLedger = {
  /** Records added, changed or deleted so far. */
  records: number;
  /** Fingerprints a person approved; each is good for one commit. */
  approved: string[];
};

export type GuardDecision =
  | { kind: "allow" }
  | { kind: "refuse"; ruleId: RuleId; reason: string }
  | {
      kind: "pause";
      ruleId: "actions.guarded";
      actionKind: ActionKind;
      change: Change;
      fingerprint: string;
      reason: string;
    };

/** Names exactly one change to one record, with its new values, so an Approval cannot be reused for another. */
export function fingerprint(change: Change): string {
  // An update is approved for the values the person was shown, not for any
  // later change of the same kind to the same record.
  const values =
    change.op === "update"
      ? [...(change.fields ?? [])]
          .sort()
          .map((field) => `${field}=${String(change.after?.[field] ?? "")}`)
          .join("|")
      : "";
  return `${actionKindOf(change)}:${change.key}${values ? `:${values}` : ""}`;
}

const RECORD_WORDS = {
  vessel: "vessel",
  line: "manifest line",
  hold: "hold on",
  berth: "berth booking for voyage",
} as const;

/** A change in plain words: "Release a customs hold (hold on MRDU4821130)". */
export function describeChange(change: Change): string {
  return `${ACTION_TITLES[actionKindOf(change)]} (${RECORD_WORDS[change.record]} ${change.key})`;
}

function containerOf(change: Change): string | null {
  if (change.record !== "line" || change.op === "delete") return null;
  if (change.op === "update" && !change.fields?.includes("container"))
    return null;
  const value = change.after?.container;
  return typeof value === "string" ? value : null;
}

/**
 * Screens no Rulebook can close: sign on, the menu and the timeout Screen.
 * Without them the Operator could not start, move or recover.
 */
export const ALWAYS_ALLOWED: readonly ScreenCode[] = [
  "HMS000",
  "HMM100",
  "HMX990",
];

export function guard(
  rulebook: Rulebook,
  ledger: GuardLedger,
  preview: Preview,
): GuardDecision {
  if (
    rulebook.screens.enabled &&
    preview.to !== preview.from &&
    !ALWAYS_ALLOWED.includes(preview.to) &&
    !rulebook.screens.allowed.includes(preview.to)
  ) {
    return {
      kind: "refuse",
      ruleId: "screens.allowed",
      reason: `Screen ${preview.to} is not one the Operator may enter.`,
    };
  }
  if (preview.changes.length === 0) return { kind: "allow" };

  if (
    rulebook.records.enabled &&
    ledger.records + preview.changes.length > rulebook.records.max
  ) {
    return {
      kind: "refuse",
      ruleId: "records.max",
      reason: `This would be record ${ledger.records + preview.changes.length} of the Run; the limit is ${rulebook.records.max}.`,
    };
  }

  for (const change of preview.changes) {
    if (rulebook.protectedFields.enabled && change.op === "update") {
      const hit = (change.fields ?? []).find((field) =>
        rulebook.protectedFields.fields.includes(
          fieldCodeOf(change.record, field) as FieldCode,
        ),
      );
      if (hit) {
        return {
          kind: "refuse",
          ruleId: "fields.protected",
          reason: `${fieldCodeOf(change.record, hit)} is a protected field: it would change from "${String(change.before?.[hit] ?? "")}" to "${String(change.after?.[hit] ?? "")}".`,
        };
      }
    }
    const container = containerOf(change);
    if (
      rulebook.checkDigit.enabled &&
      container !== null &&
      !isValidContainer(container)
    ) {
      return {
        kind: "refuse",
        ruleId: "containers.check-digit",
        reason: `Container "${container}" fails the ISO 6346 check digit (or is not 11 characters).`,
      };
    }
  }

  if (rulebook.guarded.enabled) {
    for (const change of preview.changes) {
      const actionKind = actionKindOf(change);
      if (!rulebook.guarded.actions.includes(actionKind)) continue;
      const print = fingerprint(change);
      if (ledger.approved.includes(print)) continue;
      return {
        kind: "pause",
        ruleId: "actions.guarded",
        actionKind,
        change,
        fingerprint: print,
        reason: `${describeChange(change)} needs a person.`,
      };
    }
  }
  return { kind: "allow" };
}

/** The ledger after an allowed input committed `changes`: counts them, spends the Approvals used. */
export function afterCommit(
  rulebook: Rulebook,
  ledger: GuardLedger,
  changes: Change[],
): GuardLedger {
  if (changes.length === 0) return ledger;
  const approved = [...ledger.approved];
  if (rulebook.guarded.enabled) {
    for (const change of changes) {
      if (!rulebook.guarded.actions.includes(actionKindOf(change))) continue;
      const at = approved.indexOf(fingerprint(change));
      if (at >= 0) approved.splice(at, 1);
    }
  }
  return { records: ledger.records + changes.length, approved };
}
