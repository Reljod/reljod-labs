import { words } from "./matching";
import type {
  ExtractedField,
  FieldReading,
  Span,
  SpanCorrection,
} from "./types";

/**
 * Applies the model's corrections to OCR'd Span text (ADR 0005). Only Spans that
 * exist and actually change are touched; boxes always stay the parser's.
 */
export function correctSpans(spans: Span[], corrections: SpanCorrection[]) {
  const fixes = new Map(corrections.map(({ ref, text }) => [ref, text.trim()]));
  const applied: { ref: string; from: string; to: string }[] = [];
  const corrected = spans.map((span) => {
    const text = fixes.get(span.ref);
    if (!text || text === span.text) return span;
    applied.push({ ref: span.ref, from: span.text, to: text });
    return { ...span, text };
  });
  return { spans: corrected, applied };
}

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
