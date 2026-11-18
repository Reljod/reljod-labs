import { describe, expect, it } from "vitest";
import { HOME, hrefOf, placeOf, samePlace } from "./url";

describe("placeOf", () => {
  it("opens the Run place by default", () => {
    expect(placeOf("")).toEqual(HOME);
    expect(placeOf("?tab=nonsense")).toEqual(HOME);
  });

  it("reads a tab, a Run and a recorded Run", () => {
    expect(placeOf("?tab=rules")).toEqual({ ...HOME, tab: "rules" });
    expect(placeOf("?run=abc-123")).toEqual({ ...HOME, run: "abc-123" });
    expect(placeOf("?replay=arrival-corvina")).toEqual({
      ...HOME,
      replay: "arrival-corvina",
    });
  });

  it("lets a Run win over a recorded Run, and drops ids that are not ids", () => {
    expect(placeOf("?run=r1&replay=t1")).toEqual({ ...HOME, run: "r1" });
    expect(placeOf("?run=../../etc")).toEqual(HOME);
    expect(placeOf("?replay=<script>")).toEqual(HOME);
  });
});

describe("hrefOf", () => {
  it("round-trips a place", () => {
    for (const search of [
      "",
      "?tab=hood",
      "?run=r1",
      "?tab=connect&run=r1",
      "?replay=arrival-corvina",
    ]) {
      const place = placeOf(search);
      expect(hrefOf(place, "/demos/operator")).toBe(
        `/demos/operator${search}`,
      );
      expect(samePlace(placeOf(hrefOf(place, "")), place)).toBe(true);
    }
  });
});
