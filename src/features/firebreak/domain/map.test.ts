import { describe, expect, it } from "vitest";
import { diffWords } from "./diff";
import { alight, burnOf, HEXES, WEDGES, wedgeSize } from "./map";
import { GAUGES } from "./scenario";

describe("the Fire map", () => {
  it("has the company in the middle and ten hexes per Stakeholder", () => {
    expect(HEXES).toHaveLength(61);
    expect(HEXES.filter((hex) => hex.gauge === null)).toHaveLength(1);
    for (const gauge of GAUGES) expect(wedgeSize(gauge)).toBe(10);
    expect([...WEDGES].sort()).toEqual([...GAUGES].sort());
  });

  it("burns a wedge from the rim inwards", () => {
    const wedge = HEXES.filter((hex) => hex.gauge === "press").sort(
      (a, b) => a.order - b.order,
    );
    expect(wedge[0]?.ring).toBe(4);
    expect(wedge[wedge.length - 1]?.ring).toBe(1);
  });

  it("lights more hexes as a Gauge falls", () => {
    expect(alight(95, 10)).toBe(0);
    expect(alight(53, 10)).toBe(5);
    expect(alight(10, 10)).toBe(10);
    expect([0, 1, 2, 3, 4].map((order) => burnOf(order, 3))).toEqual([
      "char",
      "flame",
      "flame",
      "warm",
      "calm",
    ]);
  });
});

describe("diffWords", () => {
  it("marks what was struck and what was added", () => {
    expect(
      diffWords(
        "It was probably the vendor.",
        "It was the vendor. Update at 18:00.",
      ),
    ).toEqual([
      { kind: "same", text: "It was " },
      { kind: "gone", text: "probably " },
      { kind: "same", text: "the vendor. " },
      { kind: "new", text: "Update at 18:00." },
    ]);
    expect(diffWords("same", "same")).toEqual([{ kind: "same", text: "same" }]);
  });

  it("keeps a rewritten sentence in whole words", () => {
    expect(
      diffWords(
        "Call now. The cause was probably a weak point.",
        "Call now. We will publish the next update at 18:00.",
      ).map((piece) => piece.kind),
    ).toEqual(["same", "gone", "new"]);
  });
});
