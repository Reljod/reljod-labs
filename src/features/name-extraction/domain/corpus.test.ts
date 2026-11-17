import { describe, expect, it } from "vitest";
import { DEFAULT_RULEBOOK, SPLITS } from "./contract";
import {
  answerKeyFor,
  CORPUS,
  corpusCards,
  FEATURED,
  generateDocument,
  generateDocumentDetailed,
} from "./corpus";
import { BOILERPLATE } from "./corpus/pools";
import { createRng } from "./corpus/prng";
import { sameParty } from "./resolve";

const squash = (text: string) => text.replace(/\s+/g, " ");

function hash(pages: string[]): number {
  let h = 0;
  for (const page of pages)
    for (let i = 0; i < page.length; i++)
      h = (Math.imul(h, 31) + page.charCodeAt(i)) | 0;
  return h;
}

describe("the PRNG", () => {
  it("repeats for a seed and differs across seeds", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("the Corpus", () => {
  it("has at least 24 Documents with unique ids and seeds", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(CORPUS.map((e) => e.id)).size).toBe(CORPUS.length);
    expect(new Set(CORPUS.map((e) => e.seed)).size).toBe(CORPUS.length);
  });

  it("covers every page size from 10 to 500", () => {
    const sizes = new Set(CORPUS.map((e) => e.pages));
    for (const n of [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500])
      expect(sizes).toContain(n);
  });

  it("splits about 50/25/25, each split with two long Documents and a 500-pager", () => {
    for (const split of SPLITS) {
      const docs = CORPUS.filter((e) => e.split === split);
      expect(docs.filter((e) => e.pages >= 100).length).toBeGreaterThanOrEqual(
        2,
      );
      expect(docs.some((e) => e.pages === 500)).toBe(true);
    }
    const share = (split: string) =>
      CORPUS.filter((e) => e.split === split).length / CORPUS.length;
    expect(share("train")).toBeGreaterThan(0.4);
    expect(share("validation")).toBeGreaterThan(0.2);
    expect(share("test")).toBeGreaterThan(0.2);
  });

  it("spans the genres of an AML file", () => {
    expect(new Set(CORPUS.map((e) => e.genre)).size).toBeGreaterThanOrEqual(9);
  });

  it("features one Document per genre, from 10 to 500 pages", () => {
    const featured = corpusCards().filter((card) => card.featured);
    expect(featured.map((card) => card.id)).toEqual(
      CORPUS.filter((e) => FEATURED.includes(e.id)).map((e) => e.id),
    );
    expect(new Set(featured.map((card) => card.genre))).toEqual(
      new Set(CORPUS.map((e) => e.genre)),
    );
    const pages = featured.map((card) => card.pages);
    expect(pages).toContain(10);
    expect(pages).toContain(500);
    expect(pages.some((n) => n >= 90 && n <= 110)).toBe(true);
  });

  it("titles read as files, not dataset ids", () => {
    for (const e of CORPUS) {
      expect(e.title).not.toMatch(/ne-|\b(train|test|validation)\b/i);
      expect(e.description).toMatch(/^[A-Z].+\.$/);
    }
  });

  it("cards count the same names the Answer key holds", () => {
    const cards = corpusCards();
    for (const card of cards.filter((c) => c.pages <= 100)) {
      expect(generateDocument(card.id).answerKey.length).toBe(
        card.expectedNames,
      );
    }
    for (const card of cards) {
      expect(card.expectedNames).toBeGreaterThanOrEqual(15);
      expect(card.expectedNames).toBeLessThanOrEqual(120);
    }
  });
});

describe("generateDocument", () => {
  it("is deterministic", () => {
    const a = generateDocument("ne-tr-03");
    const b = generateDocument("ne-tr-03");
    expect(b).toEqual(a);
    expect(hash(generateDocument("ne-te-06").document.pages)).toBe(
      hash(generateDocument("ne-te-06").document.pages),
    );
  });

  it("generates 500 pages in under 300 ms", () => {
    generateDocument("ne-va-06");
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const { document } = generateDocument("ne-va-06");
      best = Math.min(best, performance.now() - start);
      expect(document.pages).toHaveLength(500);
    }
    expect(best).toBeLessThan(300);
  });

  it("prints SPECIMEN and 1,500-3,000 characters on a typical page", () => {
    for (const id of ["ne-tr-01", "ne-va-04", "ne-te-06"]) {
      const { document } = generateDocument(id);
      const lengths = document.pages.map((p) => p.length);
      for (const page of document.pages) expect(page).toContain("SPECIMEN");
      const average = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      expect(average).toBeGreaterThan(1500);
      expect(average).toBeLessThan(3000);
      expect(Math.min(...lengths)).toBeGreaterThan(1200);
      expect(Math.max(...lengths)).toBeLessThan(4000);
    }
  });

  it("concentrates names in a long Document and prints one name only on page 437", () => {
    const { document, answerKey } = generateDocument("ne-tr-11");
    const named = new Set(answerKey.flatMap((n) => n.pages));
    expect(named.size).toBeLessThan(document.pages.length * 0.6);
    expect(
      answerKey.some((n) => n.pages.length === 1 && n.pages[0] === 437),
    ).toBe(true);
  });
});

describe("the Answer key", () => {
  // Every Document: exactness is the point of the Corpus.
  for (const entry of CORPUS) {
    it(`is exact for ${entry.id} (${entry.pages} pages)`, () => {
      const { document, answerKey, mentions } = generateDocumentDetailed(
        entry.id,
      );
      const pages = document.pages.map(squash);
      const printed = new Map<
        string,
        { aliases: Set<string>; pages: Set<number> }
      >();
      const byCanonical = new Map(answerKey.map((n) => [n.canonical, n]));
      expect(byCanonical.size).toBe(answerKey.length);

      for (const mention of mentions) {
        // Every fragment is on its page, verbatim (line breaks read as spaces).
        for (const fragment of mention.fragments)
          expect(pages[fragment.page - 1]).toContain(squash(fragment.text));
        expect(mention.fragments.map((f) => f.text).join(" ")).toBe(
          mention.alias,
        );
        if (mention.fragments.length > 1) {
          // A page-break split: the head ends one page's body, the tail opens the next.
          const [head, tail] = mention.fragments;
          expect(tail.page).toBe(head.page + 1);
        }
      }
      for (const mention of mentions) {
        const name = answerKey.find(
          (n) =>
            n.canonical === mention.alias || n.aliases.includes(mention.alias),
        );
        expect(name, mention.alias).toBeDefined();
        if (!name) continue;
        const entryFor = printed.get(name.canonical) ?? {
          aliases: new Set(),
          pages: new Set(),
        };
        entryFor.aliases.add(mention.alias);
        for (const f of mention.fragments) entryFor.pages.add(f.page);
        printed.set(name.canonical, entryFor);
      }
      for (const name of answerKey) {
        const seen = printed.get(name.canonical);
        expect(seen, name.canonical).toBeDefined();
        // Every alias was printed, and the pages are exactly where it was printed.
        expect(name.aliases).not.toContain(name.canonical);
        for (const alias of name.aliases)
          expect(seen?.aliases.has(alias), alias).toBe(true);
        expect(name.pages).toEqual(
          [...(seen?.pages ?? [])].sort((a, b) => a - b),
        );
        // On every listed page some form of the name is there (or the half of a split).
        for (const page of name.pages) {
          const text = pages[page - 1];
          const forms = [name.canonical, ...name.aliases].map(squash);
          const halves = mentions
            .filter((m) => m.fragments.length > 1 && forms.includes(m.alias))
            .flatMap((m) =>
              m.fragments
                .filter((f) => f.page === page)
                .map((f) => squash(f.text)),
            );
          expect(
            forms.some((f) => text.includes(f)) ||
              halves.some((h) => text.includes(h)),
          ).toBe(true);
        }
        // Every alias names the same party as the canonical form.
        for (const alias of name.aliases)
          expect(
            sameParty(alias, name.canonical),
            `${alias} ~ ${name.canonical}`,
          ).toBe(true);
      }
    });
  }

  it("keeps decoys and boilerplate out", () => {
    for (const entry of CORPUS.filter((e) => e.pages <= 150)) {
      const { answerKey, decoys } = generateDocumentDetailed(entry.id);
      expect(decoys.length).toBeGreaterThan(0);
      const forms = answerKey.flatMap((n) => [n.canonical, ...n.aliases]);
      for (const decoy of [
        ...decoys,
        ...BOILERPLATE,
        ...DEFAULT_RULEBOOK.exclude,
      ]) {
        for (const form of forms) {
          expect(form.toLowerCase()).not.toBe(decoy.toLowerCase());
          expect(sameParty(decoy, form), `${decoy} ~ ${form}`).toBe(false);
        }
      }
    }
  });

  it("prints 10-15% of each Document's parties only in hard forms", () => {
    const kinds = new Set<string>();
    for (const entry of CORPUS) {
      const { answerKey, mentions, hard } = generateDocumentDetailed(entry.id);
      const share = hard.length / answerKey.length;
      expect(share, entry.id).toBeGreaterThanOrEqual(0.1);
      expect(share, entry.id).toBeLessThanOrEqual(0.15);
      for (const { canonical, kind } of hard) {
        kinds.add(kind);
        const name = answerKey.find((n) => n.canonical === canonical);
        expect(name, canonical).toBeDefined();
        const forms = new Set([canonical, ...(name?.aliases ?? [])]);
        for (const m of mentions.filter((m) => forms.has(m.alias))) {
          // No clean mention anywhere: damaged, a handle, initials, or broken over a page.
          if (kind === "pagesplit") expect(m.fragments).toHaveLength(2);
          else
            expect([
              "ocr",
              "lower",
              "handle",
              "initials",
              "initialShort",
            ]).toContain(m.style);
        }
        if (kind === "pagesplit") expect(name?.pages).toHaveLength(2);
        expect(Boolean(name?.handleOnly)).toBe(kind === "handle");
      }
    }
    expect([...kinds].sort()).toEqual([
      "cell",
      "handle",
      "initials",
      "ocr",
      "pagesplit",
    ]);
  });

  it("counts handle-only names only when the Rulebook includes handles", () => {
    const key = CORPUS.map((e) => generateDocument(e.id).answerKey).find((k) =>
      k.some((n) => n.handleOnly),
    );
    expect(key).toBeDefined();
    if (!key) return;
    expect(answerKeyFor(key, { includeHandles: true })).toHaveLength(
      key.length,
    );
    expect(answerKeyFor(key, { includeHandles: false }).length).toBe(
      key.filter((n) => !n.handleOnly).length,
    );
  });

  it("plants the hard cases", () => {
    const all = CORPUS.filter((e) => e.split === "train").map((e) =>
      generateDocumentDetailed(e.id),
    );
    const styles = new Set(all.flatMap((g) => g.mentions.map((m) => m.style)));
    for (const style of [
      "initials",
      "reordered",
      "swift",
      "honorific",
      "nickname",
      "translit",
      "lower",
      "typo",
      "native",
      "alt",
    ])
      expect(styles, style).toContain(style);
    expect(
      all.some((g) => g.mentions.some((m) => m.fragments.length > 1)),
    ).toBe(true);
    const text = all.flatMap((g) => g.document.pages).join("\n");
    expect(text).toMatch(/:50K:/);
    expect(text).toMatch(/:59:/);
    expect(text).toMatch(/[a-z]\.[a-z-]+@[a-z]+\.mr/);
    expect(text).toMatch(/\b(van der|de la|bin|al-)\b/);
    expect(text).toMatch(/\b(Ltd|LLC|S\.A\.|GmbH|Holdings|Trust|Foundation)\b/);
  });
});
