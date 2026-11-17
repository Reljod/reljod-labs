import { describe, expect, it } from "vitest";
import { compareNames, standing } from "./compare";
import type { ExtractedName } from "./contract";
import type { ExpectedName } from "./corpus";
import { scoreNames } from "./score";

const found = (
  canonical: string,
  pages: number[],
  aliases: string[] = [],
): ExtractedName => ({
  canonical,
  type: "person",
  aliases,
  roles: [],
  mentions: pages.map((page) => ({ page, quote: canonical })),
  confidence: 1,
  foundBy: ["reader"],
});
const expected = (
  canonical: string,
  pages: number[],
  aliases: string[] = [],
): ExpectedName => ({ canonical, type: "person", aliases, pages });

describe("compareNames", () => {
  const key = [
    expected("Ana Lucía Ferreira-Vos", [3, 9]),
    expected("Erik Lindqvist", [5]),
    expected("Grace Okafor", [1]),
  ];
  const run = [
    found("Grace Okafor", [1, 1]),
    found("Rua Almirante Costa", [7, 2]),
    found("A. L. Ferreira-Vos", [3]),
  ];

  it("lists missed, then found, then extra, with key pages for the key's names", () => {
    const { rows } = compareNames(run, key, new Set(["Erik Lindqvist"]));
    expect(rows).toEqual([
      {
        name: "Erik Lindqvist",
        type: "person",
        status: "missed",
        foundAs: null,
        pages: [5],
        hard: true,
      },
      {
        name: "Grace Okafor",
        type: "person",
        status: "found",
        foundAs: null,
        pages: [1],
        hard: false,
      },
      {
        name: "Ana Lucía Ferreira-Vos",
        type: "person",
        status: "found",
        foundAs: "A. L. Ferreira-Vos",
        pages: [3, 9],
        hard: false,
      },
      {
        name: "Rua Almirante Costa",
        type: "person",
        status: "extra",
        foundAs: null,
        pages: [2, 7],
        hard: false,
      },
    ]);
  });

  it("scores the same as scoreNames", () => {
    expect(compareNames(run, key).score).toEqual(scoreNames(run, key));
  });

  it("lists an Upload's Names as found, with no score", () => {
    const comparison = compareNames(run, null);
    expect(comparison.score).toBeNull();
    expect(comparison.rows.every((row) => row.status === "found")).toBe(true);
    expect(comparison.rows.map((row) => row.name)).toEqual([
      "Grace Okafor",
      "Rua Almirante Costa",
      "A. L. Ferreira-Vos",
    ]);
  });
});

describe("standing", () => {
  it("labels a matched found Name with the key's canonical form", () => {
    const key = [
      expected("Ana Lucía Ferreira-Vos", [3]),
      expected("Erik Lindqvist", [5]),
    ];
    const ana = found("A. L. Ferreira-Vos", [3]);
    const street = found("Rua Almirante Costa", [3]);
    const view = standing([ana, street], key);
    expect(view.found(ana)).toEqual({
      name: "Ana Lucía Ferreira-Vos",
      status: "found",
    });
    expect(view.found(street)).toEqual({
      name: "Rua Almirante Costa",
      status: "extra",
    });
    expect(view.expected(key[0])).toBe("found");
    expect(view.expected(key[1])).toBe("missed");
  });

  it("calls everything found on an Upload", () => {
    const street = found("Rua Almirante Costa", [3]);
    expect(standing([street], null).found(street).status).toBe("found");
  });

  it("says why a hard party is hard when given the damage", () => {
    const { rows } = compareNames(
      [],
      [
        {
          canonical: "Erik Lindqvist",
          type: "person",
          aliases: [],
          pages: [2],
        },
      ],
      new Map([["Erik Lindqvist", "ocr" as const]]),
    );
    expect(rows[0]).toMatchObject({
      status: "missed",
      hard: true,
      hardReason: "ocr",
    });
  });
});
