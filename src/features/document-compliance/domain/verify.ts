import { words } from "./matching";
import type { ExtractedField, FieldReading, Span } from "./types";

/**
 * Confirms a reading is rooted in its source: every Span it cites exists, and
 * every word of the value appears in the cited Spans' text. This is what makes
 * the model's answer traceable rather than trusted (ADR 0001).
 */
export function verifyReading(
  reading: FieldReading,
  spans: Span[],
): ExtractedField {
  const byRef = new Map(spans.map((span) => [span.ref, span]));
  const cited = reading.spanRefs.map((ref) => byRef.get(ref));
  if (cited.length === 0 || cited.some((span) => span === undefined)) {
    return { ...reading, verified: false };
  }

  const citedText = cited.map((span) => span?.text ?? "").join(" ");
  const available = new Set(words(citedText));
  // The MRZ packs words together with "<", so also allow a match inside the raw text.
  const compactText = citedText.replace(/\s+/g, "").toLowerCase();
  const verified = words(reading.value).every(
    (word) => available.has(word) || compactText.includes(word),
  );
  return { ...reading, verified };
}
