import { describe, expect, it } from "vitest";
import { catalog, demoShelves } from "@/content/landing";
import { liveDemos } from "@/content/projects";
import {
  cardSpans,
  catalogEntries,
  countByFilter,
  filterEntries,
  hiddenMatch,
  highlightParts,
  rouletteSchedule,
  searchTerms,
  sortEntries,
} from "./catalog-query";

const entries = catalogEntries();
const slugs = (list: { demo: { slug: string } }[]) =>
  list.map((entry) => entry.demo.slug);

describe("catalog", () => {
  it("files every live demo once, numbered in tour order", () => {
    expect(slugs(entries)).toEqual(liveDemos.map((demo) => demo.slug));
    expect(entries.map((entry) => entry.number)).toEqual(
      liveDemos.map((_, index) => String(index + 1).padStart(2, "0")),
    );
  });

  it("shelves only live demos", () => {
    const live = liveDemos.map((demo) => demo.slug);
    for (const shelf of demoShelves)
      for (const slug of shelf.slugs) expect(live).toContain(slug);
  });

  it("finds something for every hint the search box types", () => {
    for (const hint of catalog.searchHints)
      expect(
        filterEntries(entries, searchTerms(hint), "all").length,
      ).toBeGreaterThan(0);
  });

  it("needs every word of a search, in any case", () => {
    expect(
      slugs(filterEntries(entries, searchTerms("CAT banker"), "all")),
    ).toEqual(["ledger"]);
    expect(filterEntries(entries, searchTerms("cat zebra"), "all")).toEqual([]);
  });

  it("narrows by shelf and by the New mark", () => {
    const shelf = demoShelves[0];
    expect(slugs(filterEntries(entries, [], shelf.id)).sort()).toEqual(
      [...shelf.slugs].sort(),
    );
    for (const entry of filterEntries(entries, [], "new"))
      expect(entry.demo.marks).toContain("New");
  });

  it("counts each filter under the current search", () => {
    const counts = countByFilter(entries, searchTerms("mcp"));
    expect(counts.all).toBe(
      filterEntries(entries, searchTerms("mcp"), "all").length,
    );
    expect(counts.all).toBeGreaterThan(0);
    expect(countByFilter(entries, []).all).toBe(liveDemos.length);
  });

  it("sorts by tour, newest and name without losing a demo", () => {
    const newest = sortEntries(entries, "newest");
    expect(newest[0].added).toBeGreaterThan(newest[newest.length - 1].added);
    const az = sortEntries(entries, "az").map((entry) => entry.demo.title);
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b)));
    expect(slugs(sortEntries(newest, "tour"))).toEqual(slugs(entries));
  });

  it("says why a card matched when the words aren't on it", () => {
    const harness = entries.find((entry) => entry.demo.slug === "bank-harness");
    if (!harness) throw new Error("bank-harness is not live");
    expect(hiddenMatch(harness, searchTerms("circular"))).toMatch(/circular/i);
    expect(hiddenMatch(harness, searchTerms("bank"))).toBeNull();
  });

  it("marks search hits in a text, keeping its case and special characters", () => {
    expect(highlightParts("Cat in a suit", ["cat"])).toEqual([
      { text: "Cat", hit: true },
      { text: " in a suit", hit: false },
    ]);
    expect(highlightParts("a (b) c", ["(b)"])).toEqual([
      { text: "a ", hit: false },
      { text: "(b)", hit: true },
      { text: " c", hit: false },
    ]);
    expect(highlightParts("plain", [])).toEqual([
      { text: "plain", hit: false },
    ]);
  });

  it("closes every grid row evenly", () => {
    for (let count = 1; count <= 9; count += 1) {
      const spans = cardSpans(count);
      const lg = spans.reduce((sum, span) => sum + span.lg, 0);
      const md = spans.reduce((sum, span) => sum + span.md, 0);
      expect(lg % 3).toBe(0);
      expect(md % 2).toBe(0);
    }
  });

  it("runs the roulette at least twice round, slowing down, and stops on the pick", () => {
    for (let count = 1; count <= 9; count += 1) {
      const slugs = Array.from({ length: count }, (_, index) => `d${index}`);
      for (let start = 0; start < count; start += 1)
        for (const pick of slugs) {
          const stops = rouletteSchedule(slugs, start, pick);
          expect(stops.at(-1)?.slug).toBe(pick);
          expect(stops.length).toBeGreaterThan(count * 2);
          const gaps = stops.slice(1).map((stop, i) => stop.at - stops[i].at);
          for (let i = 1; i < gaps.length; i += 1)
            expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
        }
    }
    expect(rouletteSchedule(["a"], 0, "missing")).toEqual([]);
  });

  it("leaves one-letter words unmarked", () => {
    expect(highlightParts("a cat", ["a", "cat"])).toEqual([
      { text: "a ", hit: false },
      { text: "cat", hit: true },
    ]);
  });
});
