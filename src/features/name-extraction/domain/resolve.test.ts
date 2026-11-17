import { describe, expect, it } from "vitest";
import { DEFAULT_RULEBOOK, type ExtractedName } from "./contract";
import {
  applyRulebook,
  isOrgLike,
  mergeNames,
  nameKey,
  sameParty,
} from "./resolve";

const name = (
  canonical: string,
  extra: Partial<ExtractedName> = {},
): ExtractedName => ({
  canonical,
  type: isOrgLike(canonical) ? "organization" : "person",
  aliases: [],
  roles: [],
  mentions: [{ page: 1, quote: canonical }],
  confidence: 0.8,
  foundBy: ["sweep"],
  ...extra,
});

describe("nameKey", () => {
  it("ignores case, accents, punctuation, titles and SURNAME, Given order", () => {
    expect(nameKey("Ana Lucía Ferreira-Vos")).toBe(
      nameKey("FERREIRA-VOS, Ana Lucia"),
    );
    expect(nameKey("Dr. Ana Lucía Ferreira-Vos")).toBe(
      nameKey("ana lucia ferreira-vos"),
    );
    expect(nameKey("Kestrel Maritime S.A.")).toBe(
      nameKey("KESTREL MARITIME SA"),
    );
    expect(nameKey("Halyard Holdings Limited")).toBe(
      nameKey("Halyard Holdings Ltd"),
    );
  });

  it("keeps different names apart", () => {
    expect(nameKey("Ana Ferreira")).not.toBe(nameKey("Ana Pereira"));
    expect(nameKey("Marguerite Delacroix Ltd")).not.toBe(
      nameKey("Marguerite Delacroix"),
    );
  });
});

describe("sameParty", () => {
  const same: [string, string][] = [
    ["Ana Lucía Ferreira-Vos", "ANA LUCIA FERREIRA-VOS"],
    ["Ana Lucía Ferreira-Vos", "FERREIRA-VOS, Ana Lucía"],
    ["Ana Lucía Ferreira-Vos", "A. L. Ferreira-Vos"],
    ["Ana Lucía Ferreira-Vos", "Ana Ferreira-Vos"],
    ["Ana Lucía Ferreira-Vos", "Mrs Ferreira-Vos"],
    ["Ana Lucía Ferreira-Vos", "Ferriera-Vos, Ana"],
    ["Ana Lucía Ferreira-Vos", "FERREIRA-VOS ANA LUCIA"],
    ["Mohammed Ibrahim al-Rashid", "Muhammad Ibrahim Al Rashid"],
    ["Mohammed al-Rashid", "Mohamad al-Rashid"],
    ["Aleksandr Volkov", "Alexander Volkov"],
    ["Sergei Kuznetsov", "Sergey Kouznetsov"],
    ["Natalia Fyodorova", "Natalya Fedorova"],
    ["William Ashworth", "Bill Ashworth"],
    ["Chukwuemeka Okafor", "Emeka Okafor"],
    ["Pieter van der Merwe", "VAN DER MERWE, Pieter"],
    ["Pieter van der Merwe", "P. van der Merwe"],
    ["Sheikh Khalid bin Hamad", "Khalid bin Hamad"],
    ["Hon. Justice Miriam Achterberg", "Miriam Achterberg"],
    ["Jiahui Chen", "CHEN Jiahui"],
    ["Jean-Luc Delacroix", "J. Delacroix"],
    ["Joseph Okafor", "j.okafor"],
    ["Sørensen, Astrid", "Astrid Sorensen"],
    ["Kestrel Maritime S.A.", "KESTREL MARITIME SA"],
    ["Kestrel Maritime S.A.", "Kestrel Maritime"],
    ["Kestrel Maritime S.A.", "Kestrle Maritime S.A."],
    ["Pemberton & Hollis LLP", "Pemberton and Hollis LLP"],
    ["The Albuquerque Family Trust", "Albuquerque Family Trust"],
  ];
  for (const [a, b] of same)
    it(`${a} = ${b}`, () => expect(sameParty(a, b)).toBe(true));

  const different: [string, string][] = [
    ["Ana Ferreira-Vos", "João Ferreira-Vos"],
    ["Ana Ferreira", "Ana Pereira"],
    ["Marguerite Delacroix Ltd", "Marguerite Delacroix"],
    ["Kestrel Maritime S.A.", "Kestrel Capital Ltd"],
    ["Kestrel Metals Ltd", "Kestrel Minerals Ltd"],
    ["Halvorsen Holdings", "Halvorsen Trust"],
    ["Erik Halvorsen", "Halvorsen Trading Ltd"],
    ["William Ashworth", "Robert Ashworth"],
    ["Rua Almirante Costa", "Ana Costa-Lima"],
  ];
  for (const [a, b] of different)
    it(`${a} != ${b}`, () => expect(sameParty(a, b)).toBe(false));
});

describe("mergeNames", () => {
  it("folds aliases, mentions, roles and finders, keeps the fullest canonical and the highest confidence", () => {
    const register = [
      name("A. L. Ferreira-Vos", {
        roles: ["director"],
        confidence: 0.5,
        mentions: [{ page: 4, quote: "A. L. Ferreira-Vos" }],
      }),
    ];
    const incoming = [
      name("FERREIRA-VOS, Ana Lucía", {
        roles: ["signatory"],
        confidence: 0.9,
        foundBy: ["reader"],
        mentions: [
          { page: 2, quote: "FERREIRA-VOS, Ana Lucía" },
          { page: 4, quote: "A. L. Ferreira-Vos" },
        ],
      }),
      name("Ana Lucía Ferreira-Vos", {
        mentions: [{ page: 9, quote: "Ana Lucía Ferreira-Vos" }],
      }),
    ];
    const merged = mergeNames(register, incoming, DEFAULT_RULEBOOK);
    expect(merged).toHaveLength(1);
    const [only] = merged;
    expect(only.canonical).toBe("Ana Lucía Ferreira-Vos");
    expect(only.aliases.sort()).toEqual(
      ["A. L. Ferreira-Vos", "FERREIRA-VOS, Ana Lucía"].sort(),
    );
    expect(only.mentions.map((m) => m.page)).toEqual([2, 4, 9]);
    expect(only.roles.sort()).toEqual(["director", "signatory"]);
    expect(only.foundBy.sort()).toEqual(["reader", "sweep"]);
    expect(only.confidence).toBe(0.9);
  });

  it("does not change its inputs", () => {
    const register = [name("Erik Lindqvist")];
    const incoming = [name("LINDQVIST, Erik")];
    const before = JSON.stringify([register, incoming]);
    mergeNames(register, incoming, DEFAULT_RULEBOOK);
    expect(JSON.stringify([register, incoming])).toBe(before);
  });

  it("folds only exact keys when resolveAliases is off", () => {
    const rulebook = { ...DEFAULT_RULEBOOK, resolveAliases: false };
    const merged = mergeNames(
      [name("Erik Lindqvist")],
      [name("LINDQVIST, Erik"), name("E. Lindqvist"), name("Bill Ashworth")],
      rulebook,
    );
    expect(merged.map((n) => n.canonical)).toEqual([
      "Erik Lindqvist",
      "E. Lindqvist",
      "Bill Ashworth",
    ]);
    expect(merged[0].aliases).toEqual(["LINDQVIST, Erik"]);
  });

  it("keeps a bare surname apart when it fits two people", () => {
    const merged = mergeNames(
      [name("Joseph Okafor"), name("Grace Okafor")],
      [name("Mr Okafor")],
      DEFAULT_RULEBOOK,
    );
    expect(merged).toHaveLength(3);
    expect(merged[2].note).toMatch(/ambiguous/);
  });

  it("never folds a company into a person of the same name", () => {
    const merged = mergeNames(
      [name("Marguerite Delacroix")],
      [name("Marguerite Delacroix Ltd")],
      DEFAULT_RULEBOOK,
    );
    expect(merged).toHaveLength(2);
  });
});

describe("applyRulebook", () => {
  const names = [
    name("Meridia Central Bank", { type: "organization" }),
    name("MERIDIA CENTRAL BANK", { type: "organization" }),
    name("Kestrel Maritime S.A."),
    name("Ana Ferreira", { confidence: 0.1 }),
    name("Miriam Achterberg", { roles: ["official"] }),
  ];

  it("drops the exclude list case-insensitively and keeps names in doubt", () => {
    const kept = applyRulebook(names, DEFAULT_RULEBOOK).map((n) => n.canonical);
    expect(kept).toEqual([
      "Kestrel Maritime S.A.",
      "Ana Ferreira",
      "Miriam Achterberg",
    ]);
  });

  it("applies entity types, dropBelow and officials", () => {
    const kept = applyRulebook(names, {
      ...DEFAULT_RULEBOOK,
      entityTypes: ["person"],
      dropBelow: 0.2,
      includeOfficials: false,
    }).map((n) => n.canonical);
    expect(kept).toEqual([]);
    const lowBar = applyRulebook(names, {
      ...DEFAULT_RULEBOOK,
      reviewBelow: 0.95,
    });
    expect(lowBar.map((n) => n.canonical)).toContain("Ana Ferreira");
  });

  it("matches an excluded alias too", () => {
    const kept = applyRulebook(
      [
        name("MCB", {
          type: "organization",
          aliases: ["Meridia Central Bank"],
        }),
      ],
      DEFAULT_RULEBOOK,
    );
    expect(kept).toEqual([]);
  });
});
