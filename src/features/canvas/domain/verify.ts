import type { RuleSettings } from "./rules";
import {
  type Cell,
  type Claim,
  columnIndex,
  type ParamValues,
  type QueryResult,
  type ViewSpec,
} from "./view";

/**
 * Verification: code recomputes every Claim from the View's rows and reads
 * the Finding for figures no Claim backs. A model never marks a View
 * Verified (GLOSSARY: Verified).
 */

export type ClaimCheck = {
  id: string;
  label: string;
  /** The number as narrated. */
  stated: number;
  /** The number code found, or null when it could not be computed. */
  actual: number | null;
  ok: boolean;
  /** Why it could not be computed or did not match. */
  note?: string;
  unit?: string;
  format?: Claim["format"];
};

export type FigureCheck = {
  /** The figure as written in the Finding. */
  text: string;
  value: number;
  /** The Claim that backs it, if any. */
  claimId: string | null;
};

export type Verification = {
  status: "verified" | "flagged";
  claims: ClaimCheck[];
  figures: FigureCheck[];
  /** Short reasons the View is Flagged, in words. */
  reasons: string[];
  tolerancePct: number;
};

const asNumber = (cell: Cell): number | null => {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell === "string" && cell.trim() !== "") {
    const parsed = Number(cell);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const sameCell = (cell: Cell, wanted: string | number) => {
  if (cell === null) return false;
  if (typeof wanted === "number") return asNumber(cell) === wanted;
  const text = String(cell);
  // A timestamp matches its date, so `where: { day: "2025-02-12" }` reads naturally.
  return text === wanted || text.startsWith(`${wanted} `) || text.startsWith(`${wanted}T`);
};

/** The value a Claim points at, computed from the rows. */
export function computeClaim(
  claim: Claim,
  result: QueryResult,
): { value: number } | { error: string } {
  const at = columnIndex(result, claim.from.column);
  if (at < 0)
    return { error: `The result has no column "${claim.from.column}".` };
  const filters: [number, string | number][] = [];
  for (const [column, wanted] of Object.entries(claim.from.where ?? {})) {
    const index = columnIndex(result, column);
    if (index < 0) return { error: `The result has no column "${column}".` };
    filters.push([index, wanted]);
  }
  const rows = result.rows.filter((row) =>
    filters.every(([index, wanted]) => sameCell(row[index], wanted)),
  );
  if (claim.from.aggregate === "count") return { value: rows.length };
  const values = rows
    .map((row) => asNumber(row[at]))
    .filter((value): value is number => value !== null);
  if (values.length === 0)
    return { error: "No row with a number matches this Claim." };
  switch (claim.from.aggregate) {
    case "value":
      return values.length === 1
        ? { value: values[0] }
        : {
            error: `"value" needs exactly one matching row; ${values.length} match. Add a where, or use an aggregate.`,
          };
    case "max":
      return { value: values.reduce((a, b) => Math.max(a, b)) };
    case "min":
      return { value: values.reduce((a, b) => Math.min(a, b)) };
    case "sum":
      return { value: values.reduce((a, b) => a + b, 0) };
    case "avg":
      return { value: values.reduce((a, b) => a + b, 0) / values.length };
    case "first":
      return { value: values[0] };
    case "last":
      return { value: values[values.length - 1] };
  }
}

/** Whether two numbers agree within a relative tolerance (absolute near zero). */
export function within(stated: number, actual: number, tolerancePct: number) {
  const tolerance = tolerancePct / 100;
  const scale = Math.max(Math.abs(actual), Math.abs(stated));
  if (scale < 1e-9) return true;
  return Math.abs(stated - actual) <= Math.max(scale * tolerance, 1e-9);
}

const MULTIPLIER: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  bn: 1e9,
  b: 1e9,
  billion: 1e9,
};

export type Figure = {
  text: string;
  value: number;
  /** Half of the last written digit's place: how far a rounded figure may sit from its Claim. */
  slack: number;
};

/**
 * The figures a Finding states. Dates (2025-02-12, 12 Feb, February 2025),
 * clock times, ordinals (14th) and numbers glued to letters (Q3, PM2.5) are
 * not figures: they name things, they do not measure them.
 */
export function figuresIn(text: string): Figure[] {
  const cleaned = text
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b[A-Za-z]+\d[\w.]*/g, " ")
    .replace(
      /\b\d{1,2}(?:st|nd|rd|th)?(?:\s*(?:–|-|to)\s*\d{1,2}(?:st|nd|rd|th)?)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\b(?:\s+\d{4})?/gi,
      " ",
    )
    .replace(
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*(?:–|-|to)\s*\d{1,2}(?:st|nd|rd|th)?)?\b(?:,?\s+\d{4})?/gi,
      " ",
    )
    .replace(
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi,
      " ",
    )
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, " ")
    .replace(/\b(?:FY|fiscal year|year|in|since|during)\s*(?:19|20)\d{2}\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b(?=\s*(?:–|-|to)\s*(?:19|20)\d{2}\b)/g, " ")
    .replace(/(?<=\b(?:19|20)\d{2}\s*(?:–|-|to)\s*)(?:19|20)\d{2}\b/g, " ");
  const figures: Figure[] = [];
  const pattern =
    /(?<![\w.])([-−+]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(k|m|bn|b|thousand|million|billion)?(?![\w])/gi;
  for (const match of cleaned.matchAll(pattern)) {
    const [whole, sign, integer, fraction = "", suffix] = match;
    const multiplier = suffix ? (MULTIPLIER[suffix.toLowerCase()] ?? 1) : 1;
    const magnitude =
      Number(`${integer.replace(/,/g, "")}${fraction}`) * multiplier;
    if (!Number.isFinite(magnitude)) continue;
    // A bare year standing alone is a date, not a measure.
    if (!sign && !fraction && !suffix && /^(?:19|20)\d{2}$/.test(integer))
      continue;
    const place = fraction ? 10 ** -(fraction.length - 1) : 1;
    figures.push({
      text: whole.trim(),
      value: sign === "-" || sign === "−" ? -magnitude : magnitude,
      slack: (place * multiplier) / 2,
    });
  }
  return figures;
}

/** Whether a written figure is a Claim's value, allowing for rounding, sign words and percent of a share. */
function backs(figure: Figure, claim: Claim, tolerancePct: number) {
  const candidates = [claim.value, Math.abs(claim.value)];
  // "37%" may state a share kept as 0.37.
  if (Math.abs(claim.value) <= 1) candidates.push(Math.abs(claim.value) * 100);
  return candidates.some(
    (value) =>
      Math.abs(Math.abs(figure.value) - Math.abs(value)) <= figure.slack + 1e-9 ||
      within(Math.abs(figure.value), Math.abs(value), tolerancePct),
  );
}

/**
 * Verifies a View against its rows under the Rules. `current` are the
 * Parameter values the rows were computed with: a figure equal to one of
 * them is the setting itself, not a measurement.
 */
export function verifyView(
  spec: Pick<ViewSpec, "finding" | "claims" | "params">,
  result: QueryResult,
  rules: Pick<RuleSettings, "tolerancePct" | "flagUnbackedFigures">,
  current: ParamValues = {},
): Verification {
  const reasons: string[] = [];
  const claims: ClaimCheck[] = spec.claims.map((claim) => {
    const computed = computeClaim(claim, result);
    const base = {
      id: claim.id,
      label: claim.label,
      stated: claim.value,
      unit: claim.unit,
      format: claim.format,
    };
    if ("error" in computed) {
      reasons.push(`${claim.label}: ${computed.error}`);
      return { ...base, actual: null, ok: false, note: computed.error };
    }
    const ok = within(claim.value, computed.value, rules.tolerancePct);
    if (!ok)
      reasons.push(
        `${claim.label}: the Finding says ${claim.value}, the data says ${roundTo(computed.value, 6)}.`,
      );
    return {
      ...base,
      actual: computed.value,
      ok,
      note: ok ? undefined : "Does not match the data.",
    };
  });

  const settings = new Set<number>();
  for (const param of spec.params) {
    const value = current[param.name] ?? param.value;
    if (typeof value === "number") settings.add(Math.abs(value));
  }
  const figures: FigureCheck[] = [];
  for (const figure of figuresIn(spec.finding)) {
    if (settings.has(Math.abs(figure.value))) continue;
    const claim = spec.claims.find((item) =>
      backs(figure, item, rules.tolerancePct),
    );
    figures.push({
      text: figure.text,
      value: figure.value,
      claimId: claim?.id ?? null,
    });
  }
  if (rules.flagUnbackedFigures) {
    const loose = figures.filter((figure) => figure.claimId === null);
    if (loose.length > 0)
      reasons.push(
        `The Finding states ${loose.map((figure) => figure.text).join(", ")} with no Claim behind ${loose.length === 1 ? "it" : "them"}.`,
      );
  }
  if (result.truncated && spec.claims.length > 0)
    reasons.push(
      `The Query returned ${result.rowCount} rows and was cut to ${result.rows.length}; Claims were computed on the cut rows.`,
    );
  return {
    status: reasons.length === 0 ? "verified" : "flagged",
    claims,
    figures,
    reasons,
    tolerancePct: rules.tolerancePct,
  };
}

export function roundTo(value: number, digits: number) {
  if (!Number.isFinite(value) || value === 0) return value;
  const magnitude = Math.ceil(Math.log10(Math.abs(value)));
  const factor = 10 ** (digits - magnitude);
  return Math.round(value * factor) / factor;
}
