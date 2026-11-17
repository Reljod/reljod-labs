/**
 * Writing to the Register: what Readers return and what `record_names` asks
 * for. Pure. Every quote is checked against its page before it counts.
 */
import { z } from "zod";
import {
  ENTITY_TYPES,
  type ExtractedName,
  type Finder,
  type Mention,
  ROLES,
  type Rulebook,
} from "../../domain/contract";
import { mergeNames, nameKey } from "../../domain/resolve";
import type { SweepCandidate } from "./state";

/** Whitespace-insensitive form used to check a quote is on its page. */
export function squash(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * Keeps the mentions whose quote is verbatim on its page (after whitespace
 * normalisation, so a name wrapped across lines still counts). Returns the
 * kept mentions and how many were dropped.
 */
export function verifyMentions(
  pages: string[],
  mentions: Mention[],
  allowed?: { from: number; to: number },
) {
  const squashed = new Map<number, string>();
  const kept: Mention[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const mention of mentions) {
    const page = Math.trunc(mention.page);
    const quote = squash(mention.quote ?? "");
    const inRange =
      page >= 1 &&
      page <= pages.length &&
      (!allowed || (page >= allowed.from && page <= allowed.to));
    if (!inRange || !quote) {
      dropped++;
      continue;
    }
    let text = squashed.get(page);
    if (text === undefined) {
      text = squash(pages[page - 1]);
      squashed.set(page, text);
    }
    if (!text.includes(quote)) {
      dropped++;
      continue;
    }
    const key = `${page}\u0000${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ page, quote });
  }
  return { kept, dropped };
}

// Readers -------------------------------------------------------------------------------

export const readerOutputSchema = z.object({
  names: z.array(
    z.object({
      name: z.string().min(1).max(300),
      type: z.enum(ENTITY_TYPES),
      role: z.enum(ROLES),
      quotes: z
        .array(z.object({ page: z.number().int(), quote: z.string().max(300) }))
        .max(200),
      confidence: z.number().min(0).max(1),
      note: z.string().max(500).optional(),
    }),
  ),
});
export type ReaderOutput = z.infer<typeof readerOutputSchema>;

/**
 * A Reader's names as Register entries, keeping only verifiable mentions in
 * its own range. A name left with no mention is dropped: nothing ties it to
 * the Document.
 */
export function readerNames(
  pages: string[],
  output: ReaderOutput,
  range: { from: number; to: number },
) {
  let dropped = 0;
  const names: ExtractedName[] = [];
  for (const entry of output.names) {
    const verified = verifyMentions(pages, entry.quotes, range);
    dropped += verified.dropped;
    if (verified.kept.length === 0) continue;
    const canonical = squash(entry.name);
    const aliases = [
      ...new Set(
        verified.kept
          .map((mention) => mention.quote)
          .filter((quote) => nameKey(quote) !== nameKey(canonical)),
      ),
    ];
    names.push({
      canonical,
      type: entry.type,
      aliases,
      roles: [entry.role],
      mentions: verified.kept,
      confidence: entry.confidence,
      foundBy: ["reader"],
      ...(entry.note ? { note: entry.note } : {}),
    });
  }
  return { names, dropped };
}

// record_names ---------------------------------------------------------------------------

export const recordNamesSchema = z.object({
  add: z
    .array(
      z.object({
        canonical: z.string().min(1).max(300),
        type: z.enum(ENTITY_TYPES),
        aliases: z.array(z.string().min(1).max(300)).max(50).optional(),
        roles: z.array(z.enum(ROLES)).max(9).optional(),
        mentions: z
          .array(
            z.object({ page: z.number().int(), quote: z.string().max(300) }),
          )
          .max(200)
          .describe(
            "Verbatim quotes with their page; unverifiable ones are dropped",
          ),
        confidence: z.number().min(0).max(1),
        foundBy: z
          .enum(["analyst", "code"])
          .optional()
          .describe('"code" when run_code found it'),
        note: z.string().max(500).optional(),
      }),
    )
    .max(200)
    .optional()
    .describe(
      "Names to add; merged into an existing Name that answers to the same form",
    ),
  merge: z
    .array(
      z.object({
        into: z.string().min(1).describe("Canonical of the Name to keep"),
        from: z
          .array(z.string().min(1))
          .min(1)
          .max(50)
          .describe(
            "Canonicals of Names that are the same party; they become aliases",
          ),
      }),
    )
    .max(100)
    .optional(),
  remove: z
    .array(
      z.object({
        canonical: z.string().min(1),
        reason: z.string().min(3).max(300),
      }),
    )
    .max(100)
    .optional()
    .describe("Names that are not parties (rare: recall first)"),
  dismiss: z
    .array(
      z.object({
        ids: z.array(z.number().int().min(0)).min(1).max(2000),
        reason: z.string().min(3).max(300),
      }),
    )
    .max(50)
    .optional()
    .describe("Sweep Candidates that are not parties, with the reason"),
});
export type RecordNamesInput = z.infer<typeof recordNamesSchema>;

function byCanonical(register: ExtractedName[], canonical: string) {
  const key = nameKey(canonical);
  return register.findIndex(
    (name) =>
      name.canonical === canonical ||
      (key !== "" && nameKey(name.canonical) === key),
  );
}

/** Folds `from` into `into`: aliases, roles, mentions and finders, never dropped. */
export function foldInto(
  into: ExtractedName,
  from: ExtractedName,
): ExtractedName {
  const aliases = new Set([...into.aliases, from.canonical, ...from.aliases]);
  aliases.delete(into.canonical);
  const mentions = [...into.mentions];
  const seen = new Set(mentions.map((m) => `${m.page}\u0000${m.quote}`));
  for (const mention of from.mentions) {
    const key = `${mention.page}\u0000${mention.quote}`;
    if (!seen.has(key)) {
      seen.add(key);
      mentions.push(mention);
    }
  }
  mentions.sort((a, b) => a.page - b.page);
  const notes = [into.note, from.note].filter(Boolean);
  return {
    ...into,
    aliases: [...aliases],
    roles: [...new Set([...into.roles, ...from.roles])],
    mentions,
    confidence: Math.max(into.confidence, from.confidence),
    foundBy: [...new Set<Finder>([...into.foundBy, ...from.foundBy])],
    ...(notes.length ? { note: [...new Set(notes)].join(" ") } : {}),
  };
}

export type RecordOutcome = {
  register: ExtractedName[];
  dismissed: Record<string, string>;
  report: string[];
  changed: boolean;
};

/**
 * Applies one `record_names` call. Only this (and Readers' merges) writes to
 * the Register. Returns the new Register and dismissals and a report of what
 * happened, including what was refused and why.
 */
export function applyRecord(input: {
  register: ExtractedName[];
  dismissed: Record<string, string>;
  record: RecordNamesInput;
  pages: string[];
  candidates: SweepCandidate[];
  rulebook: Rulebook;
}): RecordOutcome {
  let register = [...input.register];
  const dismissed = { ...input.dismissed };
  const report: string[] = [];
  let changed = false;

  if (input.record.add?.length) {
    let droppedMentions = 0;
    const incoming: ExtractedName[] = [];
    for (const entry of input.record.add) {
      const verified = verifyMentions(input.pages, entry.mentions);
      droppedMentions += verified.dropped;
      const canonical = squash(entry.canonical);
      incoming.push({
        canonical,
        type: entry.type,
        aliases: [...new Set((entry.aliases ?? []).map(squash))].filter(
          (alias) => alias && alias !== canonical,
        ),
        roles: entry.roles?.length ? entry.roles : ["other"],
        mentions: verified.kept,
        confidence: entry.confidence,
        foundBy: [entry.foundBy ?? "analyst"],
        ...(entry.note ? { note: entry.note } : {}),
      });
    }
    const before = register.length;
    register = mergeNames(register, incoming, input.rulebook);
    changed = true;
    report.push(
      `Added ${incoming.length} name${incoming.length === 1 ? "" : "s"} (${register.length - before} new, the rest merged into existing Names).`,
    );
    if (droppedMentions > 0)
      report.push(
        `Dropped ${droppedMentions} mention${droppedMentions === 1 ? "" : "s"} whose quote is not verbatim on its page.`,
      );
  }

  for (const merge of input.record.merge ?? []) {
    const target = byCanonical(register, merge.into);
    if (target < 0) {
      report.push(`merge refused: no Name "${merge.into}" in the Register.`);
      continue;
    }
    const missing: string[] = [];
    let folded = 0;
    for (const canonical of merge.from) {
      const index = byCanonical(register, canonical);
      if (index < 0) {
        missing.push(canonical);
        continue;
      }
      const into = byCanonical(register, merge.into);
      if (index === into) continue;
      register[into] = foldInto(register[into], register[index]);
      register = register.filter((_, position) => position !== index);
      folded++;
    }
    if (folded) changed = true;
    report.push(
      `Merged ${folded} into "${register[byCanonical(register, merge.into)]?.canonical ?? merge.into}"${missing.length ? `; not found: ${missing.map((item) => `"${item}"`).join(", ")}` : ""}.`,
    );
  }

  for (const removal of input.record.remove ?? []) {
    const index = byCanonical(register, removal.canonical);
    if (index < 0) {
      report.push(`remove refused: no Name "${removal.canonical}".`);
      continue;
    }
    register = register.filter((_, position) => position !== index);
    changed = true;
    report.push(`Removed "${removal.canonical}": ${removal.reason}`);
  }

  if (input.record.dismiss?.length) {
    const known = new Set(input.candidates.map((candidate) => candidate.id));
    let count = 0;
    const unknown: number[] = [];
    for (const group of input.record.dismiss) {
      for (const id of group.ids) {
        if (!known.has(id)) {
          unknown.push(id);
          continue;
        }
        dismissed[String(id)] = group.reason;
        count++;
      }
    }
    report.push(
      `Dismissed ${count} Candidate${count === 1 ? "" : "s"}${unknown.length ? `; unknown ids: ${unknown.slice(0, 20).join(", ")}` : ""}.`,
    );
  }

  if (report.length === 0) report.push("Nothing to record.");
  return { register, dismissed, report, changed };
}

/** The Register as an event carries it: mentions capped per Name to keep the trail small. */
export function forEvent(register: ExtractedName[], mentionsPerName = 20) {
  return register.map((name) =>
    name.mentions.length > mentionsPerName
      ? { ...name, mentions: name.mentions.slice(0, mentionsPerName) }
      : name,
  );
}
