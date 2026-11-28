import type {
  DocumentJudgments,
  DocumentKind,
  FieldName,
  FieldReading,
  Span,
  SpanCorrection,
} from "../domain/types";
import type { ReadUsage } from "../metrics";
import type { DocumentExtraction, DocumentReader } from "./ports";

/*
 * The reader of the stubbed e2e suite: no model call. It knows what is
 * printed on every preset pack (the values `fixtures/document-compliance/
 * generate.py` renders) and finds each value among the Spans the real parser
 * produced, the way the model is told to: it cites the Spans a value is in,
 * and on an OCR'd Document corrects misread words (and words OCR dropped)
 * inside those Spans. Code then verifies every reading exactly as it does a
 * model's, so a value this reader cannot place fails verification like a
 * model's would.
 */

export const SCRIPTED_MODEL = "stub/scripted-reader";

type Printed = {
  surname: string;
  givenNames: string;
  dateOfBirth: string;
  dateOfIssue: string;
  /** The expiry printed on the data page (and on its certified copy). */
  printedExpiry: string;
  /** The real expiry the machine-readable zone carries, YYMMDD. */
  mrzExpiry: string;
  /** The printed expiry was pasted over (the tampered pack). */
  tampered: boolean;
  accountHolder: string;
  statementDate: string;
  address: string;
  wording: string;
  certifierName: string;
  certifierOccupation: string;
  certificationDate: string;
};

const DEFAULTS: Printed = {
  surname: "VELASCO",
  givenNames: "AMARA LUCIA",
  dateOfBirth: "14 MAR 1991",
  dateOfIssue: "10 MAY 2022",
  printedExpiry: "09 MAY 2032",
  mrzExpiry: "320509",
  tampered: false,
  accountHolder: "Amara L. Velasco",
  statementDate: "02 Oct 2026",
  address: "14 Harbour View Road, Port Selene MR-2041, Republic of Meridia",
  wording:
    "I certify that this is a true copy of the original document, which I have seen.",
  certifierName: "Daniel K. Ortez",
  certifierOccupation: "Notary Public",
  certificationDate: "20 Oct 2026",
};

/** Each pack's deliberate flaw, as `generate.py` prints it. */
const PACKS: Record<string, Partial<Printed>> = {
  clean: {},
  "expired-passport": {
    dateOfIssue: "31 AUG 2016",
    printedExpiry: "30 AUG 2026",
    mrzExpiry: "260830",
  },
  "stale-bill": { statementDate: "15 Jun 2026" },
  "name-mismatch": { accountHolder: "Marisol Velasco" },
  "tampered-passport": {
    dateOfIssue: "12 SEP 2015",
    printedExpiry: "11 SEP 2029",
    mrzExpiry: "250911",
    tampered: true,
  },
  "incomplete-certification": {
    certifierOccupation: "",
    certificationDate: "",
  },
};

function printedFields(
  kind: DocumentKind,
  printed: Printed,
): [FieldName, string][] {
  const name = `${printed.givenNames} ${printed.surname}`;
  const fields: [FieldName, string][] =
    kind === "identity_document"
      ? [
          ["full_name", name],
          ["date_of_birth", printed.dateOfBirth],
          ["date_of_issue", printed.dateOfIssue],
          ["date_of_expiry", printed.printedExpiry],
          ["mrz_date_of_expiry", printed.mrzExpiry],
        ]
      : kind === "proof_of_address"
        ? [
            ["full_name", printed.accountHolder],
            ["statement_date", printed.statementDate],
            ["address", printed.address],
          ]
        : [
            ["full_name", name],
            ["date_of_birth", printed.dateOfBirth],
            ["date_of_expiry", printed.printedExpiry],
            ["certification_wording", printed.wording],
            ["certifier_name", printed.certifierName],
            ["certifier_occupation", printed.certifierOccupation],
            ["certification_date", printed.certificationDate],
          ];
  // A blank on the Document is left out, as the model is told to.
  return fields.filter(([, value]) => value !== "");
}

/** A word and where it sits in its text. */
type Word = { text: string; start: number; end: number };

function wordsOf(text: string): Word[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Levenshtein distance, for OCR misreads such as "Vethsco" for "VELASCO". */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The window of `text` closest to `pattern` (approximate substring match):
 * its start, end and distance. For machine-readable lines, where OCR inserts
 * spaces and swaps characters inside one long run.
 */
function closestWindow(pattern: string, text: string) {
  let best = { start: 0, end: 0, distance: Number.POSITIVE_INFINITY };
  for (let start = 0; start < text.length; start++) {
    for (
      let end = start + Math.max(1, pattern.length - 1);
      end <= Math.min(text.length, start + pattern.length + 1);
      end++
    ) {
      const distance = editDistance(pattern, text.slice(start, end));
      if (distance < best.distance) best = { start, end, distance };
    }
  }
  return best;
}

/** How a value word was found in one Span. */
type Hit =
  | { how: "exact" }
  | { how: "inside" }
  | { how: "misread"; word: Word }
  | { how: "window"; start: number; end: number };

const isLongNumber = (word: string) => /^\d{6,}$/.test(word);

/** Where `token` is in `span`, if it is: exactly, inside a run, or misread (OCR only). */
function hitIn(span: Span, spanWords: Word[], token: string, ocr: boolean) {
  const folded = fold(token);
  if (spanWords.some((word) => fold(word.text) === folded)) {
    return { how: "exact" } as Hit;
  }
  if (isLongNumber(folded)) {
    const compact = span.text.replace(/\s+/g, "");
    if (fold(compact).includes(folded)) return { how: "inside" } as Hit;
    if (ocr && span.text.includes("<")) {
      const window = closestWindow(folded, fold(compact));
      if (window.distance <= 1) return { how: "window", ...window } as Hit;
    }
    return null;
  }
  if (!ocr || folded.length < 4) return null;
  const allowed = Math.max(1, Math.round(folded.length * 0.3));
  let best: { word: Word; distance: number } | null = null;
  for (const word of spanWords) {
    const distance = editDistance(fold(word.text), folded);
    if (distance <= allowed && (!best || distance < best.distance)) {
      best = { word, distance };
    }
  }
  return best ? ({ how: "misread", word: best.word } as Hit) : null;
}

/**
 * The Spans a value is printed in, and the corrections that make them say it.
 * Spans are picked greedily: the one that holds the most of what is still
 * missing, weighed by how much of the Span is the value (so a footer that
 * happens to repeat a town loses to the address line), until every word is
 * placed or no Span adds one.
 */
export function placeValue(
  value: string,
  spans: Span[],
  ocr: boolean,
): { spanRefs: string[]; corrections: SpanCorrection[] } {
  const tokens = wordsOf(value).map((word) => word.text);
  const covered = tokens.map(() => false);
  const chosen: { span: Span; hits: Map<number, Hit> }[] = [];
  const spanWords = new Map(
    spans.map((span) => [span.ref, wordsOf(span.text)]),
  );

  for (;;) {
    let best: { span: Span; hits: Map<number, Hit>; score: number } | null =
      null;
    for (const span of spans) {
      if (chosen.some((item) => item.span.ref === span.ref)) continue;
      const words = spanWords.get(span.ref) ?? [];
      const hits = new Map<number, Hit>();
      tokens.forEach((token, index) => {
        if (covered[index]) return;
        const hit = hitIn(span, words, token, ocr);
        if (hit) hits.set(index, hit);
      });
      if (hits.size === 0) continue;
      // A word the value repeats ("I certify … I have seen") counts once.
      const placedChars = [
        ...new Set([...hits.keys()].map((index) => fold(tokens[index]))),
      ].reduce((sum, word) => sum + word.length, 0);
      const longNumber = [...hits.keys()].some((index) =>
        isLongNumber(tokens[index]),
      );
      const share = longNumber
        ? 1
        : Math.min(1, hits.size / Math.max(1, words.length));
      const score = placedChars * share;
      if (score >= 2 && (!best || score > best.score)) {
        best = { span, hits, score };
      }
    }
    if (!best) break;
    chosen.push({ span: best.span, hits: best.hits });
    for (const index of best.hits.keys()) covered[index] = true;
    if (covered.every(Boolean)) break;
  }

  const first = (item: { hits: Map<number, Hit> }) =>
    Math.min(...item.hits.keys());
  chosen.sort((a, b) => first(a) - first(b));

  const corrections: SpanCorrection[] = [];
  if (ocr && chosen.length > 0) {
    // A word OCR dropped (the "I" of "I certify") goes in front of the Span
    // that holds the next word of the value, or after the last one.
    const prefixes = new Map<string, string[]>();
    const suffix: string[] = [];
    tokens.forEach((token, index) => {
      if (covered[index]) return;
      const next = chosen.find((item) => first(item) > index);
      if (next) {
        prefixes.set(next.span.ref, [
          ...(prefixes.get(next.span.ref) ?? []),
          token,
        ]);
      } else suffix.push(token);
    });
    chosen.forEach((item, position) => {
      let text = item.span.text;
      const hits = [...item.hits.entries()];
      const window = hits.find(([, hit]) => hit.how === "window");
      if (window) {
        const [index, hit] = window as [
          number,
          Extract<Hit, { how: "window" }>,
        ];
        const compact = text.replace(/\s+/g, "");
        text = `${compact.slice(0, hit.start)}${tokens[index]}${compact.slice(hit.end)}`;
      } else {
        // Misread words, replaced from the end so earlier positions hold.
        const misread = hits
          .filter(([, hit]) => hit.how === "misread")
          .map(([index, hit]) => ({
            token: tokens[index],
            word: (hit as Extract<Hit, { how: "misread" }>).word,
          }))
          .sort((a, b) => b.word.start - a.word.start);
        for (const { token, word } of misread) {
          text = `${text.slice(0, word.start)}${token}${text.slice(word.end)}`;
        }
      }
      const prefix = prefixes.get(item.span.ref);
      if (prefix) text = `${prefix.join(" ")} ${text}`;
      if (position === chosen.length - 1 && suffix.length > 0) {
        text = `${text} ${suffix.join(" ")}`;
      }
      if (text !== item.span.text) {
        corrections.push({ ref: item.span.ref, text });
      }
    });
  }
  return { spanRefs: chosen.map((item) => item.span.ref), corrections };
}

/** Roughly what the model would have been billed for, so the run's metrics read like a live run's. */
function usageOf(spans: Span[], pages: number, fields: number): ReadUsage {
  const characters = spans.reduce((sum, span) => sum + span.text.length, 0);
  return {
    model: SCRIPTED_MODEL,
    provider: "stub",
    inputTokens: Math.ceil(characters / 4) + 800 * pages,
    outputTokens: 40 * fields,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    costUsd: 0,
  };
}

export const scriptedReader: DocumentReader = {
  model: SCRIPTED_MODEL,
  async read(input) {
    const printed = PACKS[input.packSlug];
    if (!printed) {
      throw new Error(
        `The scripted reader has no answers for ${input.packSlug}`,
      );
    }
    const values = { ...DEFAULTS, ...printed };
    const corrections = new Map<string, string>();
    const readings: FieldReading[] = [];
    for (const [name, value] of printedFields(input.kind, values)) {
      // Each value is placed against the Spans as corrected so far.
      const current = input.spans.map((span) => {
        const text = corrections.get(span.ref);
        return text === undefined ? span : { ...span, text };
      });
      const placed = placeValue(value, current, input.ocr);
      for (const { ref, text } of placed.corrections)
        corrections.set(ref, text);
      const reading = {
        name,
        value,
        spanRefs: placed.spanRefs,
        confidence: 0.96,
      };
      readings.push(reading);
      await input.onReading?.(reading);
    }
    const expiry = readings.find(
      (reading) => reading.name === "date_of_expiry",
    );
    const tampered = values.tampered && input.kind === "identity_document";
    const judgments: DocumentJudgments = {
      legible: true,
      tamperingSuspected: tampered,
      tamperingSpanRefs: tampered ? (expiry?.spanRefs ?? []) : [],
      signaturePresent: input.kind === "certified_copy" ? true : null,
      notes: tampered
        ? "The printed expiry date is in a different font from the rest of the data page, and the machine-readable zone gives an earlier one."
        : "",
    };
    const spanCorrections = [...corrections].map(([ref, text]) => ({
      ref,
      text,
    }));
    const result: DocumentExtraction = {
      readings,
      judgments,
      corrections: input.ocr ? spanCorrections : [],
      usage: usageOf(input.spans, input.pageImages.length, readings.length),
      raw: { corrections: spanCorrections, fields: readings, judgments },
    };
    return result;
  },
};
