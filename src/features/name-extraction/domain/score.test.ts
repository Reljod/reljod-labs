import { describe, expect, it } from "vitest";
import type { ExtractedName } from "./contract";
import type { ExpectedName } from "./corpus";
import { scoreNames } from "./score";

const found = (canonical: string, aliases: string[] = []): ExtractedName => ({
  canonical,
  type: "person",
  aliases,
  roles: [],
  mentions: [],
  confidence: 1,
  foundBy: ["analyst"],
});
const expected = (canonical: string, aliases: string[] = []): ExpectedName => ({
  canonical,
  type: "person",
  aliases,
  pages: [1],
});

describe("scoreNames", () => {
  it("scores a perfect run", () => {
    const score = scoreNames(
      [found("Ana Ferreira"), found("Kestrel Maritime S.A.")],
      [expected("Ana Ferreira"), expected("Kestrel Maritime S.A.")],
    );
    expect(score).toEqual({
      expected: 2,
      found: 2,
      truePositives: 2,
      recall: 1,
      precision: 1,
      missed: [],
    });
  });

  it("matches through aliases on either side", () => {
    const score = scoreNames(
      [found("A. L. Ferreira-Vos"), found("Chuck", ["Emeka Okafor"])],
      [
        expected("Ana Lucía Ferreira-Vos"),
        expected("Chukwuemeka Okafor", ["OKAFOR, Chukwuemeka"]),
      ],
    );
    expect(score.truePositives).toBe(2);
  });

  it("lists missed canonicals and counts precision", () => {
    const score = scoreNames(
      [
        found("Ana Ferreira"),
        found("Port Selene"),
        found("Rua Almirante Costa"),
      ],
      [expected("Ana Ferreira"), expected("Erik Lindqvist")],
    );
    expect(score.recall).toBe(0.5);
    expect(score.precision).toBeCloseTo(1 / 3);
    expect(score.missed).toEqual(["Erik Lindqvist"]);
  });

  it("matches one to one", () => {
    // One "Mrs Okafor" cannot be both Okafors; two full names can.
    const one = scoreNames(
      [found("Mrs Okafor")],
      [expected("Grace Okafor"), expected("Ngozi Okafor")],
    );
    expect(one.truePositives).toBe(1);
    const two = scoreNames(
      [found("Mrs Okafor"), found("Grace Okafor")],
      [expected("Grace Okafor"), expected("Ngozi Okafor")],
    );
    // The bare surname goes to Ngozi so that Grace keeps her exact match.
    expect(two.truePositives).toBe(2);
  });

  it("handles empty lists", () => {
    expect(scoreNames([], [])).toMatchObject({ recall: 1, precision: 1 });
    expect(scoreNames([], [expected("Ana Ferreira")])).toMatchObject({
      recall: 0,
      precision: 0,
      missed: ["Ana Ferreira"],
    });
    expect(scoreNames([found("Ana Ferreira")], [])).toMatchObject({
      recall: 1,
      precision: 0,
    });
  });
});
