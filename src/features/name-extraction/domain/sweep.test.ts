import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULEBOOK,
  type DocumentText,
  type Rulebook,
  SPLITS,
  type Split,
} from "./contract";
import { CORPUS, type ExpectedName, generateDocument } from "./corpus";
import { sameParty } from "./resolve";
import { type Candidate, sweep } from "./sweep";

const doc = (...pages: string[]): DocumentText => ({
  id: "t",
  title: "t",
  pages,
});
const texts = (candidates: Candidate[]) => candidates.map((c) => c.text);
const run = (pages: string[], rulebook: Rulebook = DEFAULT_RULEBOOK) =>
  sweep(doc(...pages), rulebook);

/** An expected Name is recalled when some Candidate names the same party as one of its forms. */
function recalled(candidates: Candidate[], expected: ExpectedName[]) {
  return expected.filter((name) => {
    const forms = [name.canonical, ...name.aliases];
    return candidates.some((c) => forms.some((f) => sameParty(c.text, f)));
  }).length;
}

function splitReport(split: Split) {
  let expected = 0;
  let hits = 0;
  let candidates = 0;
  for (const entry of CORPUS.filter((e) => e.split === split)) {
    const { document, answerKey } = generateDocument(entry.id);
    const found = sweep(document, DEFAULT_RULEBOOK);
    expected += answerKey.length;
    hits += recalled(found, answerKey);
    candidates += found.length;
  }
  return { recall: hits / expected, perName: candidates / expected, expected };
}

/**
 * Floors the Sweep really reaches. About 13% of each Document's parties are
 * printed only in hard forms (OCR damage, unlabelled cells, page breaks,
 * handles, initials); the Sweep finds some of them and leaves the rest to
 * the Readers and the Analyst. Measured: train 0.932, validation 0.914.
 */
const FLOOR: Record<"train" | "validation", number> = {
  train: 0.92,
  validation: 0.9,
};

describe("sweep on the Corpus", () => {
  for (const split of ["train", "validation"] as const) {
    it(`recalls at least ${FLOOR[split]} of the ${split} split`, () => {
      const report = splitReport(split);
      console.info(
        `sweep ${split}: recall ${report.recall.toFixed(4)}, ${report.perName.toFixed(2)} candidates per expected name`,
      );
      expect(report.recall).toBeGreaterThanOrEqual(FLOOR[split]);
      expect(report.perName).toBeLessThan(4);
    });
  }

  it("reports the test split without asserting it", () => {
    const report = splitReport("test");
    console.info(
      `sweep test: recall ${report.recall.toFixed(4)}, ${report.perName.toFixed(2)} candidates per expected name`,
    );
    expect(SPLITS).toContain("test");
  });

  it("sweeps 500 pages in under 500 ms", () => {
    const { document } = generateDocument("ne-tr-11");
    sweep(document, DEFAULT_RULEBOOK);
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      sweep(document, DEFAULT_RULEBOOK);
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThan(500);
  });
});

describe("sweep patterns", () => {
  it("finds capitalised names with particles, hyphens and initials", () => {
    const found = texts(
      run([
        "The funds went to Pieter van der Merwe and then to A. L. Ferreira-Vos on 3 May.",
      ]),
    );
    expect(found).toContain("Pieter van der Merwe");
    expect(found).toContain("A. L. Ferreira-Vos");
  });

  it("finds SURNAME, Given and ALL CAPS names", () => {
    const found = run([
      "Holder        Shares",
      "FERREIRA-VOS, Ana Lucía   200",
      "ANA LUCIA FERREIRA-VOS   300",
    ]);
    expect(texts(found)).toContain("FERREIRA-VOS, Ana Lucía");
    expect(
      found.find((c) => c.text === "FERREIRA-VOS, Ana Lucía")?.signals,
    ).toContain("reordered");
    expect(texts(found)).toContain("ANA LUCIA FERREIRA-VOS");
  });

  it("keeps the honorific with the name and guesses a person", () => {
    const found = run(["Present: Mrs Okafor, Sheikh Khalid bin Hamad"]);
    const okafor = found.find((c) => c.text === "Mrs Okafor");
    expect(okafor?.typeGuess).toBe("person");
    expect(texts(found)).toContain("Sheikh Khalid bin Hamad");
  });

  it("finds organizations by their suffix and stops at the suffix", () => {
    const found = run([
      "Controlled by Bramble Holdings B.V. Seabright Investments BV resigned on 2 May.",
    ]);
    expect(texts(found)).toContain("Bramble Holdings B.V.");
    expect(texts(found)).toContain("Seabright Investments BV");
    expect(
      found.find((c) => c.text === "Seabright Investments BV")?.typeGuess,
    ).toBe("organization");
  });

  it("reads SWIFT party fields and lowercase labelled values", () => {
    const found = run([
      [
        ":50K:/MR12MCBK0000123456",
        "OKAFOR CHUKWUEMEKA",
        "14 RUA ALMIRANTE COSTA",
        "Beneficiary:   ana lucia ferreira-vos",
      ].join("\n"),
    ]);
    expect(texts(found)).toContain("OKAFOR CHUKWUEMEKA");
    expect(
      found.find((c) => c.text === "OKAFOR CHUKWUEMEKA")?.signals,
    ).toContain("swift:50K");
    expect(texts(found)).toContain("ana lucia ferreira-vos");
  });

  it("joins a name broken across a line and across a page", () => {
    const line = run([
      "The balance was remitted to Ana Lucía\nFerreira-Vos on the same day.",
    ]);
    expect(
      line.find((c) => c.text === "Ana Lucía Ferreira-Vos")?.signals,
    ).toContain("line-join");
    const header = "BANK HEADER";
    const footer = (n: number) => `Page ${n} of 4`;
    const page = run([
      `${header}\nfiller text one.\nordered by Babatunde\n${footer(1)}`,
      `${header}\nBalogun as usual.\n${footer(2)}`,
      `${header}\nnothing here.\n${footer(3)}`,
      `${header}\nnothing here either.\n${footer(4)}`,
    ]);
    const joined = page.find((c) => c.text === "Babatunde Balogun");
    expect(joined?.signals).toContain("page-join");
    expect(joined?.pages).toEqual([1, 2]);
  });

  it("filters streets, vessels, places, months and form labels", () => {
    const found = texts(
      run([
        "Beneficiary Name: Kestrel Maritime S.A., 14 Rua Almirante Costa, Port Selene. Loaded on the MV Santa Leonor on 12 March 2026. Chief Compliance Officer.",
      ]),
    );
    expect(found).toContain("Kestrel Maritime S.A.");
    for (const decoy of [
      "Rua Almirante Costa",
      "Almirante Costa",
      "Port Selene",
      "MV Santa Leonor",
      "Santa Leonor",
      "March",
      "Beneficiary Name",
      "Chief Compliance Officer",
    ])
      expect(found).not.toContain(decoy);
  });

  it("proposes email handles only when the Rulebook asks", () => {
    const line =
      "From: desk <j.okafor@kestrelmaritime.mr>, info@kestrelmaritime.mr";
    expect(texts(run([line]))).toContain("j.okafor");
    expect(texts(run([line]))).not.toContain("info");
    expect(
      texts(run([line], { ...DEFAULT_RULEBOOK, includeHandles: false })),
    ).not.toContain("j.okafor");
  });

  it("respects exclude, entity types and officials", () => {
    const page =
      "Meridia Central Bank paid Kestrel Maritime S.A. on behalf of Ana Ferreira, witnessed by Hon. Justice Miriam Achterberg.";
    const all = texts(run([page]));
    expect(all).not.toContain("Meridia Central Bank");
    expect(all).toContain("Kestrel Maritime S.A.");
    expect(all).toContain("Hon. Justice Miriam Achterberg");
    const people = texts(
      run([page], {
        ...DEFAULT_RULEBOOK,
        entityTypes: ["person"],
        includeOfficials: false,
      }),
    );
    expect(people).toContain("Ana Ferreira");
    expect(people).not.toContain("Kestrel Maritime S.A.");
    expect(people).not.toContain("Hon. Justice Miriam Achterberg");
  });

  it("counts mentions and pages per Candidate", () => {
    const found = run([
      "Paid to Erik Lindqvist.",
      "Erik Lindqvist again, and Erik Lindqvist.",
    ]);
    const erik = found.find((c) => c.text === "Erik Lindqvist");
    expect(erik?.count).toBe(3);
    expect(erik?.pages).toEqual([1, 2]);
  });
});
