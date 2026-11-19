import type {
  BerthBooking,
  Books,
  Change,
  Hold,
  ManifestLine,
  RecordKind,
  Vessel,
} from "./types";

/** A deep copy: the Books are plain JSON. */
export function cloneBooks(books: Books): Books {
  return {
    vessels: books.vessels.map((v) => ({ ...v })),
    lines: books.lines.map((l) => ({ ...l })),
    holds: books.holds.map((h) => ({ ...h })),
    berths: books.berths.map((b) => ({ ...b })),
  };
}

export const lineKey = (voyage: string, lineNo: number) =>
  `${voyage}#${lineNo}`;

export function vesselByVoyage(
  books: Books,
  voyage: string,
): Vessel | undefined {
  return books.vessels.find((v) => v.voyage === voyage);
}

/** A voyage's lines in line-number order. */
export function linesOf(books: Books, voyage: string): ManifestLine[] {
  return books.lines
    .filter((l) => l.voyage === voyage)
    .sort((a, b) => a.lineNo - b.lineNo);
}

export function holdOn(books: Books, container: string): Hold | undefined {
  return books.holds.find((h) => h.container === container);
}

export function bookingOf(
  books: Books,
  voyage: string,
): BerthBooking | undefined {
  return books.berths.find((b) => b.voyage === voyage);
}

type Keyed = { key: string; value: Record<string, unknown> };

function keyed(books: Books, record: RecordKind): Keyed[] {
  switch (record) {
    case "vessel":
      return books.vessels.map((v) => ({ key: v.imo, value: v }));
    case "line":
      return books.lines.map((l) => ({
        key: lineKey(l.voyage, l.lineNo),
        value: l,
      }));
    case "hold":
      return books.holds.map((h) => ({ key: h.container, value: h }));
    case "berth":
      return books.berths.map((b) => ({ key: b.voyage, value: b }));
  }
}

const KINDS: RecordKind[] = ["vessel", "line", "hold", "berth"];

/**
 * Every difference between two states of the Books. Stable order: vessels,
 * lines, holds, berths; within a kind the updates and deletes in the order
 * of `before`, then the adds in the order of `after`.
 */
export function diffBooks(before: Books, after: Books): Change[] {
  const changes: Change[] = [];
  for (const record of KINDS) {
    const was = keyed(before, record);
    const now = keyed(after, record);
    const nowByKey = new Map(now.map((k) => [k.key, k.value]));
    const wasKeys = new Set(was.map((k) => k.key));
    for (const { key, value } of was) {
      const next = nowByKey.get(key);
      if (!next) {
        changes.push({ op: "delete", record, key, before: { ...value } });
        continue;
      }
      const names = [...new Set([...Object.keys(value), ...Object.keys(next)])];
      const fields = names.filter((name) => value[name] !== next[name]);
      if (fields.length > 0) {
        changes.push({
          op: "update",
          record,
          key,
          before: { ...value },
          after: { ...next },
          fields,
        });
      }
    }
    for (const { key, value } of now) {
      if (!wasKeys.has(key)) {
        changes.push({ op: "add", record, key, after: { ...value } });
      }
    }
  }
  return changes;
}
