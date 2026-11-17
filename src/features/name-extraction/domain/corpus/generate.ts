/**
 * Generates a Corpus Document from its seed: picks the parties, decides which
 * pages carry names (concentrated in sections, with filler between, and a few
 * names printed once near the end), renders every page and computes the
 * Answer key from what was printed.
 */
import type { DocumentText, EntityType } from "../contract";
import { GENERIC_SPLIT, GENRES, type Genre, renderHard } from "./genres";
import {
  type DocState,
  type MentionRecord,
  PageBuilder,
  type Slot,
} from "./page";
import {
  type HardKind,
  makeOrganization,
  makePerson,
  type OfficialKind,
  type Party,
  type Taken,
} from "./parties";
import { createRng, hashSeed, type Rng } from "./prng";

export type ExpectedName = {
  canonical: string;
  type: EntityType;
  aliases: string[];
  pages: number[];
  /**
   * Printed only as an email address: expected only when the Rulebook's
   * includeHandles is on (see answerKeyFor).
   */
  handleOnly?: boolean;
};

export type GenerateInput = {
  id: string;
  title: string;
  genre: string;
  pages: number;
  seed: number;
};

export type GeneratedDocument = {
  document: DocumentText;
  answerKey: ExpectedName[];
  /** Every printed name, with where it sits; for tests and the renderer. */
  mentions: MentionRecord[];
  /** Decoys printed in the Document: never in the Answer key. */
  decoys: string[];
  /** Parties printed only in hard forms, by canonical form. */
  hard: { canonical: string; kind: HardKind }[];
};

/** How many parties a Document of this length names: 15 at 10 pages, 120 at 500. */
export function partyCount(pages: number, seed: number): number {
  const base = 15 + ((pages - 10) * 105) / 490;
  const jitter = (hashSeed("count", seed) % 5) - 2;
  return Math.max(15, Math.min(120, Math.round(base) + jitter));
}

/** The parties of a Document; cheap, so the picker can count names without rendering. */
export function planParties(input: GenerateInput): {
  parties: Party[];
  holder?: Party;
} {
  const rng = createRng(hashSeed("parties", input.seed));
  const genre = GENRES[input.genre];
  const taken: Taken = { surnames: new Set(), orgs: new Set() };
  const total = partyCount(input.pages, input.seed);
  const parties: Party[] = [];
  const officials: OfficialKind[] = [...genre.officials];
  let holder: Party | undefined;
  if (genre.holder) {
    holder =
      genre.holder === "person"
        ? makePerson(rng, 0, taken)
        : makeOrganization(rng, 0, taken);
    parties.push(holder);
  }
  while (parties.length < total) {
    const index = parties.length;
    const official = officials.shift();
    if (official) parties.push(makePerson(rng, index, taken, official));
    else if (rng.chance(0.56)) parties.push(makePerson(rng, index, taken));
    else parties.push(makeOrganization(rng, index, taken));
  }
  markHard(input.seed, parties, holder);
  return { parties, holder };
}

/** Share of a Document's parties printed only in hard forms. */
export const HARD_SHARE = 0.13;

/** Picks the hard-only parties: seeded, never the holder or an official. */
function markHard(seed: number, parties: Party[], holder?: Party) {
  const rng = createRng(hashSeed("hard", seed));
  const eligible = parties.filter((p) => p !== holder && !p.official);
  const count = Math.max(2, Math.round(parties.length * HARD_SHARE));
  for (const party of rng.shuffle([...eligible]).slice(0, count)) {
    party.hard =
      party.type === "person"
        ? rng.weighted<HardKind>({
            ocr: 30,
            cell: 25,
            pagesplit: 15,
            handle: 12,
            initials: 18,
          })
        : rng.weighted<HardKind>({ ocr: 40, cell: 35, pagesplit: 25 });
  }
}

const PAGE_CAP = 5;

/** Which parties are printed on which pages. */
function allocate(
  rng: Rng,
  pages: number,
  parties: Party[],
): Map<number, Party[]> {
  // Name-bearing pages: all of a short Document, sections of a long one.
  const namePages: number[] = [];
  if (pages <= 30) for (let p = 1; p <= pages; p++) namePages.push(p);
  else {
    const marked = new Set<number>([1, 2]);
    const clusters = Math.max(3, Math.round(pages / 30));
    for (let c = 0; c < clusters; c++) {
      const start = rng.int(1, pages);
      const length = rng.int(3, 9);
      for (let p = start; p < start + length && p <= pages; p++) marked.add(p);
    }
    if (pages >= 437) marked.add(437);
    namePages.push(...[...marked].sort((a, b) => a - b));
  }
  const load = new Map<number, Party[]>();
  const add = (page: number, party: Party) => {
    let target = page;
    // Spill to the nearest name page with room.
    if ((load.get(target)?.length ?? 0) >= PAGE_CAP) {
      const index = namePages.indexOf(page);
      for (let d = 1; d < namePages.length; d++) {
        const candidates = [namePages[index + d], namePages[index - d]];
        const free = candidates.find(
          (p) =>
            p !== undefined &&
            (load.get(p)?.length ?? 0) < PAGE_CAP &&
            !load.get(p)?.includes(party),
        );
        if (free !== undefined) {
          target = free;
          break;
        }
      }
    }
    const list = load.get(target) ?? [];
    if (!list.includes(party)) list.push(party);
    load.set(target, list);
  };

  const tailCount =
    pages >= 100
      ? Math.max(2, Math.round(parties.length * 0.12))
      : Math.round(parties.length * 0.08);
  const tailPages = namePages.filter((p) => p > pages * 0.6);
  const shuffled = rng.shuffle([...parties]);
  const splitPages = new Set<number>();
  let tails = 0;
  for (const party of shuffled) {
    if (party.hard === "pagesplit") {
      // Exactly one mention, broken over a page; one such break per page.
      const free = namePages.filter((p) => p < pages && !splitPages.has(p));
      const page = free.length > 0 ? rng.pick(free) : rng.int(1, pages - 1);
      splitPages.add(page);
      const list = load.get(page) ?? [];
      list.push(party);
      load.set(page, list);
      continue;
    }
    if (party.hard) {
      const mentions = rng.int(1, 3);
      for (let m = 0; m < mentions; m++) add(rng.pick(namePages), party);
      continue;
    }
    if (
      tails < tailCount &&
      tailPages.length > 0 &&
      party.official === undefined
    ) {
      party.tail = true;
      const page = tails === 0 && pages >= 437 ? 437 : rng.pick(tailPages);
      tails++;
      add(page, party);
      continue;
    }
    const mentions = rng.int(2, pages >= 100 ? 7 : 4);
    const home = rng.int(0, namePages.length - 1);
    for (let m = 0; m < mentions; m++) {
      const near = rng.chance(0.7);
      const index = near
        ? Math.max(0, Math.min(namePages.length - 1, home + rng.int(-4, 4)))
        : rng.int(0, namePages.length - 1);
      add(namePages[index], party);
    }
  }
  return load;
}

export function generate(input: GenerateInput): GeneratedDocument {
  const genre: Genre = GENRES[input.genre];
  if (!genre) throw new Error(`Corpus: unknown genre ${input.genre}`);
  const { parties, holder } = planParties(input);
  const rng = createRng(hashSeed("pages", input.seed));
  const placed = parties.filter((p) => p !== holder);
  const load = allocate(rng, input.pages, placed);
  const seen = new Set<number>();
  const doc: DocState = {
    title: input.title,
    pages: input.pages,
    mentions: [],
    decoys: new Set(),
    day: hashSeed("day", input.seed) % 300,
    dayScale: Math.min(1, 700 / (input.pages * 6)),
    serial: hashSeed("serial", input.seed) % 9000,
    fixed: new Map(),
    domains: parties.filter((p) => p.domain).map((p) => p.domain as string),
  };

  // Names that will break across a page: narrative genres, parties printed more than once.
  const printedOn = new Map<number, number>();
  for (const list of load.values())
    for (const p of list)
      printedOn.set(p.index, (printedOn.get(p.index) ?? 0) + 1);

  const texts: string[] = [];
  let carry: string | undefined;
  for (let page = 1; page <= input.pages; page++) {
    const pb = new PageBuilder(doc, page, rng);
    genre.header(pb, holder ? { party: holder, first: page === 1 } : undefined);
    if (carry) {
      pb.para(carry);
      pb.line();
      carry = undefined;
    }
    const slots: Slot[] = (load.get(page) ?? []).map((party) => {
      const first = !seen.has(party.index);
      seen.add(party.index);
      return { party, first };
    });
    rng.shuffle(slots);
    // Officials print in their own block.
    for (const slot of slots.filter((s) => s.party.official))
      genre.official(pb, slot);
    const hard = slots.filter(
      (s) => s.party.hard && s.party.hard !== "pagesplit",
    );
    let rest = slots.filter((s) => !s.party.official && !s.party.hard);
    let split: Slot | undefined = slots.find(
      (s) => s.party.hard === "pagesplit",
    );
    if (
      !split &&
      genre.split &&
      page < input.pages &&
      rng.chance(Math.min(0.5, 40 / input.pages + 0.1))
    ) {
      split = rest.find(
        (s) =>
          !s.first && (printedOn.get(s.party.index) ?? 0) > 1 && !s.party.tail,
      );
      if (split) rest = rest.filter((s) => s !== split);
    }
    const target = rng.int(1750, 2400);
    const fillerPositions = rng.chance(0.5);
    if (fillerPositions && rest.length > 0) rng.pick(genre.fillers)(pb);
    while (rest.length > 0) {
      const head = rest[0];
      const fits = genre.blocks.filter(
        (b) => !b.wants || b.wants[0] === head.party.type,
      );
      const block = rng.pick(fits);
      const want = rng.int(1, block.max);
      const taken: Slot[] = [head];
      for (let position = 1; position < want; position++) {
        const type = block.wants?.[position];
        const next = rest.find(
          (s) => !taken.includes(s) && (!type || s.party.type === type),
        );
        if (!next) break;
        taken.push(next);
      }
      block.render(pb, taken);
      rest = rest.filter((s) => !taken.includes(s));
    }
    for (const slot of hard) renderHard(pb, { ...slot, first: false });
    const fillers = rng.shuffle([
      ...genre.fillers,
      ...genre.fillers,
      ...genre.fillers,
      ...genre.fillers,
    ]);
    let guard = 0;
    while (pb.chars < target && guard < fillers.length) fillers[guard++](pb);
    if (split) {
      const [before, after] = (genre.split ?? GENERIC_SPLIT)(pb);
      const [head, tail] = pb.splitName(split);
      pb.para(`${before} ${head}`);
      carry = `${tail} ${after}`;
    }
    pb.line();
    pb.line(
      `${input.id.toUpperCase()} - Confidential - SPECIMEN          Page ${page} of ${input.pages}`,
    );
    texts.push(pb.lines.join("\n"));
  }

  const byParty = new Map<
    number,
    { aliases: Set<string>; pages: Set<number> }
  >();
  for (const mention of doc.mentions) {
    const entry = byParty.get(mention.party) ?? {
      aliases: new Set(),
      pages: new Set(),
    };
    entry.aliases.add(mention.alias);
    for (const fragment of mention.fragments) entry.pages.add(fragment.page);
    byParty.set(mention.party, entry);
  }
  const answerKey: ExpectedName[] = [];
  for (const party of parties) {
    const entry = byParty.get(party.index);
    if (!entry) continue;
    answerKey.push({
      canonical: party.canonical,
      type: party.type,
      aliases: [...entry.aliases].filter((a) => a !== party.canonical),
      pages: [...entry.pages].sort((a, b) => a - b),
      ...(party.hard === "handle" ? { handleOnly: true } : {}),
    });
  }
  return {
    document: { id: input.id, title: input.title, pages: texts },
    answerKey,
    mentions: doc.mentions,
    decoys: [...doc.decoys],
    hard: parties.flatMap((p) =>
      p.hard ? [{ canonical: p.canonical, kind: p.hard }] : [],
    ),
  };
}
