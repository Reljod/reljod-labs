import type { Books, Change, ScreenCode } from "../legacy/types";
import { ALWAYS_ALLOWED, describeChange, fingerprint } from "./guard";
import { isValidContainer } from "./iso6346";
import type { ManifestRow } from "./manifest";
import {
  actionKindOf,
  type FieldCode,
  fieldCodeOf,
  type Rulebook,
  type RuleId,
} from "./rules";
import type { Expectation } from "./task";

/**
 * The checks after a Run: code compares HARBOURMASTER's Books before and
 * after against what the Task asked and against the Rules, and returns
 * Findings. Only this says a Run was done correctly; the Operator's own
 * summary is never taken for it (ADR 0025).
 */

export type FindingLevel = "pass" | "fail" | "warn" | "info";

export type Finding = {
  /** The Rule it comes from, or `task.outcome` for the Task's own Expectations. */
  id: RuleId | "task.outcome";
  level: FindingLevel;
  title: string;
  detail?: string;
};

/** `correct`: checked and nothing failed. `unverified`: Rules held, but nothing to compare the outcome with. */
export type Verdict = "correct" | "incorrect" | "unverified";

const same = (a: unknown, b: unknown) =>
  String(a ?? "").trim() === String(b ?? "").trim();

/** Whether a Change is the one an Expectation asks for, and no more than it. */
export function satisfies(expectation: Expectation, change: Change): boolean {
  if (expectation.op !== change.op || expectation.record !== change.record)
    return false;
  const picked = change.op === "delete" ? change.before : change.after;
  if (!picked) return false;
  for (const [field, value] of Object.entries(expectation.where))
    if (!same(picked[field], value)) return false;
  if (change.op === "delete") return true;
  const values = expectation.values ?? {};
  for (const [field, value] of Object.entries(values))
    if (!same(change.after?.[field], value)) return false;
  // An amend that touches a field nobody asked about is not the amend asked for.
  if (change.op === "update")
    return (change.fields ?? []).every((field) => field in values);
  return true;
}

/** Pairs each Expectation with the Change that satisfies it (each Change used once). */
export function matchExpectations(expected: Expectation[], changes: Change[]) {
  const used = new Set<number>();
  const matched = expected.map((expectation) => {
    const at = changes.findIndex(
      (change, index) => !used.has(index) && satisfies(expectation, change),
    );
    if (at < 0) return null;
    used.add(at);
    return changes[at];
  });
  return { matched, extra: changes.filter((_, index) => !used.has(index)) };
}

/** Which Expectations the Books already meet: the live checklist. */
export function progressOf(expected: Expectation[], changes: Change[]) {
  return matchExpectations(expected, changes).matched.map(
    (change) => change !== null,
  );
}

const GOODS_WIDTH = 24;

/** A Manifest row against the Books: the fields that differ, or null when the line is missing. */
function rowProblems(
  row: ManifestRow,
  books: Books,
  voyage: string | undefined,
): string[] | null {
  const line = books.lines.find(
    (item) =>
      item.container === row.container &&
      (voyage === undefined || item.voyage === voyage),
  );
  if (!line) return null;
  const want: Record<string, string | number> = {
    isoType: row.isoType.toUpperCase(),
    seal: row.seal.toUpperCase(),
    grossKg: row.grossKg,
    pol: row.pol.toUpperCase(),
    consignee: row.consignee.toUpperCase(),
    haz: row.haz.toUpperCase(),
    goods: row.goods.toUpperCase().slice(0, GOODS_WIDTH).trim(),
  };
  const have = line as unknown as Record<string, unknown>;
  return Object.entries(want)
    .filter(([field, value]) => !same(have[field], value))
    .map(
      ([field, value]) =>
        `${field} is "${String(have[field])}", the Manifest says "${value}"`,
    );
}

export type EvaluateInput = {
  rulebook: Rulebook;
  /** The Task's Expectations; null for an own Task. */
  expected: Expectation[] | null;
  /** The attached Manifest, parsed; null when there is none. */
  manifest: { voyage?: string; lines: ManifestRow[] } | null;
  /** What the Books changed by, from the Fixture to the end of the Run. */
  changes: Change[];
  after: Books;
  signedOn: boolean;
  /** Every Screen the Run was on. */
  screens: ScreenCode[];
  /** Fingerprints a person approved during the Run. */
  approved: string[];
  /** A person at the keyboard needs nobody's approval. */
  byHand: boolean;
};

export function evaluate(input: EvaluateInput): {
  verdict: Verdict;
  findings: Finding[];
} {
  const { rulebook, changes } = input;
  const findings: Finding[] = [];

  // The Task's outcome ---------------------------------------------------------------
  let extra = changes;
  if (input.expected) {
    const result = matchExpectations(input.expected, changes);
    extra = result.extra;
    input.expected.forEach((expectation, index) => {
      findings.push({
        id: "task.outcome",
        level: result.matched[index] ? "pass" : "fail",
        title: expectation.label,
        ...(result.matched[index]
          ? {}
          : { detail: "Not found in the Books as asked." }),
      });
    });
    if (rulebook.scope.enabled) {
      if (extra.length === 0)
        findings.push({
          id: "changes.in-scope",
          level: "pass",
          title: "Nothing changed beyond the Task",
        });
      for (const change of extra)
        findings.push({
          id: "changes.in-scope",
          level: "fail",
          title: `Not asked for: ${describeChange(change)}`,
          ...(change.fields?.length
            ? { detail: `Fields changed: ${change.fields.join(", ")}.` }
            : {}),
        });
    }
  }

  // The Manifest ---------------------------------------------------------------------
  if (input.manifest && rulebook.manifest.enabled) {
    const { lines, voyage } = input.manifest;
    const problems: string[] = [];
    for (const row of lines) {
      const found = rowProblems(row, input.after, voyage);
      if (found === null) problems.push(`${row.container}: not in the Books`);
      else if (found.length > 0)
        problems.push(`${row.container}: ${found.join("; ")}`);
    }
    findings.push(
      problems.length === 0
        ? {
            id: "manifest.matches",
            level: "pass",
            title: `All ${lines.length} Manifest rows are in the Books, field for field`,
          }
        : {
            id: "manifest.matches",
            level: "fail",
            title: `${problems.length} of ${lines.length} Manifest rows are missing or differ`,
            detail: problems.slice(0, 12).join("\n"),
          },
    );
  }

  // The Rules, checked again on what was actually committed ---------------------------
  if (rulebook.checkDigit.enabled) {
    const bad = changes
      .filter((change) => change.record === "line" && change.op !== "delete")
      .map((change) => String(change.after?.container ?? ""))
      .filter((container) => !isValidContainer(container));
    if (bad.length > 0)
      findings.push({
        id: "containers.check-digit",
        level: "fail",
        title: `${bad.length} container number${bad.length === 1 ? "" : "s"} in the Books fail the check digit`,
        detail: bad.join(", "),
      });
    else if (
      changes.some(
        (change) => change.record === "line" && change.op !== "delete",
      )
    )
      findings.push({
        id: "containers.check-digit",
        level: "pass",
        title: "Every container number keyed has a valid check digit",
      });
  }

  if (rulebook.protectedFields.enabled) {
    for (const change of changes) {
      if (change.op !== "update") continue;
      const hit = (change.fields ?? []).filter((field) =>
        rulebook.protectedFields.fields.includes(
          fieldCodeOf(change.record, field) as FieldCode,
        ),
      );
      if (hit.length > 0)
        findings.push({
          id: "fields.protected",
          level: "fail",
          title: `Protected field changed: ${hit.map((field) => fieldCodeOf(change.record, field)).join(", ")}`,
          detail: describeChange(change),
        });
    }
  }

  if (rulebook.records.enabled && changes.length > rulebook.records.max)
    findings.push({
      id: "records.max",
      level: "fail",
      title: `${changes.length} records changed; the limit is ${rulebook.records.max}`,
    });

  if (rulebook.screens.enabled) {
    const entered = [...new Set(input.screens)].filter(
      (code) =>
        !ALWAYS_ALLOWED.includes(code) &&
        !rulebook.screens.allowed.includes(code),
    );
    if (entered.length > 0)
      findings.push({
        id: "screens.allowed",
        level: "fail",
        title: `Entered a Screen that is not allowed: ${entered.join(", ")}`,
      });
  }

  if (rulebook.guarded.enabled) {
    const approved = [...input.approved];
    for (const change of changes) {
      if (!rulebook.guarded.actions.includes(actionKindOf(change))) continue;
      if (input.byHand) {
        findings.push({
          id: "actions.guarded",
          level: "info",
          title: `${describeChange(change)}: done by a person at the keyboard`,
        });
        continue;
      }
      const at = approved.indexOf(fingerprint(change));
      if (at >= 0) approved.splice(at, 1);
      findings.push(
        at >= 0
          ? {
              id: "actions.guarded",
              level: "pass",
              title: `${describeChange(change)}: approved by a person`,
            }
          : {
              id: "actions.guarded",
              level: "fail",
              title: `${describeChange(change)}: committed without a person's approval`,
            },
      );
    }
  }

  if (rulebook.signOff.enabled)
    findings.push(
      input.signedOn
        ? {
            id: "session.sign-off",
            level: "warn",
            title: "The session was left signed on",
          }
        : {
            id: "session.sign-off",
            level: "pass",
            title: "The session was signed off",
          },
    );

  const failed = findings.some((finding) => finding.level === "fail");
  const compared =
    input.expected !== null ||
    (input.manifest !== null && rulebook.manifest.enabled);
  return {
    verdict: failed ? "incorrect" : compared ? "correct" : "unverified",
    findings,
  };
}
