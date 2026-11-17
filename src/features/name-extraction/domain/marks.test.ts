import { describe, expect, it } from "vitest";
import type { ExtractedName, PageMark } from "./contract";
import type { ExpectedName } from "./corpus";
import { generateDocumentDetailed } from "./corpus";
import {
  isSurfaceForm,
  keyMarks,
  MAX_MARKS_PER_PAGE,
  type MarkTarget,
  markPage,
  runMarks,
  splitPieces,
} from "./marks";

const target = (
  name: string,
  forms: string[] = [name],
  status: MarkTarget["status"] = "expected",
): MarkTarget => ({ name, type: "person", status, forms });

const slice = (text: string, marks: PageMark[]) =>
  marks.map((m) => text.slice(m.start, m.end));

describe("markPage", () => {
  it("marks every exact occurrence with UTF-16 offsets", () => {
    const text =
      "Paid by Ana Lucía Ferreira-Vos. Later, Ana Lucía Ferreira-Vos again.";
    const marks = markPage(text, [target("Ana Lucía Ferreira-Vos")]);
    expect(marks).toHaveLength(2);
    expect(slice(text, marks)).toEqual([
      "Ana Lucía Ferreira-Vos",
      "Ana Lucía Ferreira-Vos",
    ]);
    expect(marks[0]).toEqual({
      start: 8,
      end: 30,
      status: "expected",
      name: "Ana Lucía Ferreira-Vos",
      type: "person",
    });
  });

  it("finds a name split over a line break and maps back to the original text", () => {
    const text = "Instruction from Mr Erik\n    Lindqvist, dated today.";
    const marks = markPage(text, [target("Erik Lindqvist")]);
    expect(marks).toHaveLength(1);
    expect(slice(text, marks)).toEqual(["Erik\n    Lindqvist"]);
    expect(marks[0].start).toBe(text.indexOf("Erik"));
    expect(marks[0].end).toBe(text.indexOf(",", marks[0].start));
  });

  it("folds whitespace in the form too (a quote copied with its line break)", () => {
    const text = "Signed: Grace   Okafor";
    const marks = markPage(text, [target("Grace", ["Grace\nOkafor"])]);
    expect(slice(text, marks)).toEqual(["Grace   Okafor"]);
  });

  it("falls back to case-insensitive search only for a form not found as written", () => {
    const text =
      "BENEFICIARY: KESTREL MARITIME S.A. / ref Kestrel Maritime S.A.";
    const exact = markPage(text, [target("Kestrel Maritime S.A.")]);
    expect(slice(text, exact)).toEqual(["Kestrel Maritime S.A."]);
    const caps = markPage("BENEFICIARY: KESTREL MARITIME S.A.", [
      target("Kestrel Maritime S.A."),
    ]);
    expect(slice("BENEFICIARY: KESTREL MARITIME S.A.", caps)).toEqual([
      "KESTREL MARITIME S.A.",
    ]);
  });

  it("matches whole words only", () => {
    const text = "Vosburgh paid Vos; Vos-Ana is not Ana.";
    const marks = markPage(text, [target("Vos"), target("Ana")]);
    expect(marks.map((m) => [m.name, text.slice(m.start, m.end)])).toEqual([
      ["Vos", "Vos"],
      ["Vos", "Vos"],
      ["Ana", "Ana"],
      ["Ana", "Ana"],
    ]);
    expect(marks[1].start).toBe(text.indexOf("Vos-Ana"));
  });

  it("lets the longest span win an overlap and never overlaps", () => {
    const text = "Director: Grace Okafor (Mrs Okafor), Okafor Holdings Ltd.";
    const marks = markPage(text, [
      target("Okafor", ["Okafor"]),
      target("Grace Okafor", ["Grace Okafor", "Mrs Okafor"]),
      { ...target("Okafor Holdings Ltd"), type: "organization" },
    ]);
    expect(marks.map((m) => [m.name, text.slice(m.start, m.end)])).toEqual([
      ["Grace Okafor", "Grace Okafor"],
      ["Grace Okafor", "Mrs Okafor"],
      ["Okafor Holdings Ltd", "Okafor Holdings Ltd"],
    ]);
    for (let i = 1; i < marks.length; i++)
      expect(marks[i].start).toBeGreaterThanOrEqual(marks[i - 1].end);
  });

  it("breaks a tie on the same span by target order", () => {
    const text = "Call Mr Okafor.";
    const marks = markPage(text, [
      target("Chukwuemeka Okafor", ["Mr Okafor"], "missed"),
      target("Tunde Okafor", ["Mr Okafor"], "found"),
    ]);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      name: "Chukwuemeka Okafor",
      status: "missed",
    });
  });

  it("ignores empty and one-letter forms", () => {
    expect(markPage("A B C", [target("x", ["", " ", "A"])])).toEqual([]);
    expect(markPage("", [target("Ana")])).toEqual([]);
  });

  it("caps the marks, keeping the longest", () => {
    const text = `${"Ana ".repeat(10)}Ana Lucía Ferreira`;
    const marks = markPage(
      text,
      [target("Ana"), target("Ana Lucía Ferreira")],
      3,
    );
    expect(marks).toHaveLength(3);
    expect(marks.some((m) => m.name === "Ana Lucía Ferreira")).toBe(true);
    expect(MAX_MARKS_PER_PAGE).toBeGreaterThan(50);
  });
});

const expected = (
  canonical: string,
  pages: number[],
  aliases: string[] = [],
): ExpectedName => ({ canonical, type: "person", aliases, pages });

const found = (
  canonical: string,
  mentions: { page: number; quote: string }[],
  aliases: string[] = [],
): ExtractedName => ({
  canonical,
  type: "person",
  aliases,
  roles: [],
  mentions,
  confidence: 1,
  foundBy: ["reader"],
});

describe("keyMarks", () => {
  it("marks only names the key prints on that page, in every form", () => {
    const text = "OKAFOR, Chukwuemeka sent funds to Erik Lindqvist.";
    const key = [
      expected("Chukwuemeka Okafor", [2], ["OKAFOR, Chukwuemeka"]),
      expected("Erik Lindqvist", [3]),
    ];
    const marks = keyMarks(2, text, key, () => "expected");
    expect(slice(text, marks)).toEqual(["OKAFOR, Chukwuemeka"]);
    expect(marks[0].name).toBe("Chukwuemeka Okafor");
  });
});

describe("runMarks", () => {
  it("marks quotes, canonical and aliases on the pages the Name was found on", () => {
    const text = "From A. Ferreira to Kestrel; Ana Ferreira signed.";
    const names = [
      found("Ana Ferreira", [{ page: 4, quote: "A. Ferreira" }]),
      found("Kestrel Maritime", [{ page: 5, quote: "Kestrel" }]),
    ];
    const marks = runMarks(4, text, names, (n) => ({
      name: n.canonical,
      status: "found",
    }));
    expect(slice(text, marks)).toEqual(["A. Ferreira", "Ana Ferreira"]);
  });

  it("labels marks the way it is told", () => {
    const text = "Paid to Kestrel.";
    const marks = runMarks(
      1,
      text,
      [found("Kestrel", [{ page: 1, quote: "Kestrel" }])],
      () => ({ name: "Kestrel Maritime S.A.", status: "extra" }),
    );
    expect(marks[0]).toMatchObject({
      name: "Kestrel Maritime S.A.",
      status: "extra",
    });
  });
});

describe("on a Corpus Document", () => {
  it("marks every party the key prints on a page, names split over a page break too", () => {
    const { document, answerKey, mentions } =
      generateDocumentDetailed("ne-te-03");
    const pieces = splitPieces(mentions, answerKey);
    expect(pieces.size).toBeGreaterThan(0);
    let pairs = 0;
    for (const name of answerKey) {
      for (const page of name.pages) {
        pairs++;
        const text = document.pages[page - 1];
        const marks = keyMarks(page, text, [name], () => "expected", pieces);
        expect(
          marks.length,
          `${name.canonical} on page ${page}`,
        ).toBeGreaterThan(0);
        for (const mark of marks)
          expect(mark.end).toBeLessThanOrEqual(text.length);
      }
    }
    expect(pairs).toBeGreaterThan(50);
  });
});

describe("splitPieces", () => {
  it("files each piece under its page and the key's canonical form", () => {
    const key = [expected("Irina Kuznetsova", [71, 72], ["Ms Kuznetsova"])];
    const pieces = splitPieces(
      [
        {
          alias: "Irina Kuznetsova",
          fragments: [
            { page: 71, text: "Irina" },
            { page: 72, text: "Kuznetsova" },
          ],
        },
        {
          alias: "Ms Kuznetsova",
          fragments: [{ page: 71, text: "Ms Kuznetsova" }],
        },
      ],
      key,
    );
    expect(pieces.size).toBe(2);
    const text = "end of page 71 ... Irina";
    expect(
      slice(
        text,
        keyMarks(71, text, key, () => "missed", pieces),
      ),
    ).toEqual(["Irina"]);
  });
});

describe("run marks from mention quotes", () => {
  const name = {
    canonical: "Meridian Deposit Guarantee Scheme",
    type: "organization" as const,
    aliases: [],
    roles: [],
    mentions: [],
    confidence: 0.5,
    foundBy: ["reader" as const],
  };

  it("marks a quote that is the name as printed, not a sentence around it", () => {
    expect(
      isSurfaceForm("j0seph okonkwo", { ...name, canonical: "Joseph Okonkwo" }),
    ).toBe(true);
    expect(
      isSurfaceForm(
        "Deposits are protected by the Meridian Deposit Guarantee Scheme up to M$ 100,000 per depositor.",
        name,
      ),
    ).toBe(false);
    expect(
      isSurfaceForm("by the Meridian Deposit Guarantee Scheme", name),
    ).toBe(false);
    expect(isSurfaceForm("Meridian Deposit Guarantee Scheme", name)).toBe(true);
  });

  it("refuses a damaged spelling quoted with the sentence around it", () => {
    const halyard = { ...name, canonical: "Halyard Holdings Limited" };
    expect(isSurfaceForm("Halyrad Holdings Limited", halyard)).toBe(true);
    expect(
      isSurfaceForm("Halyrad Holdings Limited acted as nominee", halyard),
    ).toBe(false);
  });

  it("takes a reordered form that holds a bare-surname alias", () => {
    const okafor = {
      ...name,
      type: "person" as const,
      canonical: "Folake Okafor",
      aliases: ["Okafor"],
    };
    expect(isSurfaceForm("OKAFOR, Folake", okafor)).toBe(true);
    expect(isSurfaceForm("Mrs Okafor signed", okafor)).toBe(false);
  });

  it("matches a known form on word boundaries only", () => {
    const ana = { ...name, type: "person" as const, canonical: "Ana" };
    // "ana" inside "Banana" is not the alias, so the quote is not context.
    expect(isSurfaceForm("Banana", ana)).toBe(true);
    expect(isSurfaceForm("Ana Lucía", ana)).toBe(false);
  });

  it("marks only the name inside a sentence quote", () => {
    const text =
      "Deposits are protected by the Meridian Deposit Guarantee Scheme up to M$ 100,000 per depositor.";
    const marks = runMarks(
      1,
      text,
      [
        {
          ...name,
          mentions: [{ page: 1, quote: text }],
        },
      ],
      (n) => ({ name: n.canonical, status: "extra" }),
    );
    expect(marks).toHaveLength(1);
    expect(text.slice(marks[0].start, marks[0].end)).toBe(
      "Meridian Deposit Guarantee Scheme",
    );
  });
});

describe("damaged spellings with context", () => {
  it("does not mark a damaged name plus a word of context whole", () => {
    const name = {
      canonical: "Halyard Holdings Limited",
      type: "organization" as const,
      aliases: [],
      roles: [],
      mentions: [],
      confidence: 0.5,
      foundBy: ["reader" as const],
    };
    expect(isSurfaceForm("Halyrad Holdings Limited acted", name)).toBe(false);
    expect(isSurfaceForm("Halyrad Holdings Limited", name)).toBe(true);
  });
});
