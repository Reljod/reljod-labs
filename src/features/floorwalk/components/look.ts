import { ruleById, type Severity, type Standard } from "../domain/rules";
import type { Finding } from "../domain/walk";

/** Severity colours, from the Colonnade palette. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#b23a2b",
  major: "#d9a84e",
  minor: "#1d4e89",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

export function severityOf(finding: Finding, standard: Standard): Severity {
  return (
    standard[finding.rule]?.severity ??
    ruleById(finding.rule)?.severity ??
    "minor"
  );
}

export function clock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** A steady tint for a zone name, so the ribbon and the plan agree. */
export function zoneTint(name: string): string {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${(h * 7) % 360} 45% 82%)`;
}

export function money(usd: number | null): string {
  if (usd === null) return "—";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`;
}
