import { describe, expect, it } from "vitest";
import { answerKeyFor } from "./answer-key";
import { walkInstructions, walkPrompt } from "./brief";
import { ruleById, rulesFor } from "./rules";
import { routeAt, SITES, zoneAt } from "./sites";

describe("the Sample Sites", () => {
  for (const site of SITES) {
    describe(site.slug, () => {
      it("plants problems only under Rules that apply to the Site, with props that exist", () => {
        const ids = new Set([
          ...site.props.map((p) => p.id),
          ...site.doors.map((d) => d.id),
        ]);
        for (const planted of site.planted) {
          expect(ruleById(planted.rule)?.kinds).toContain(site.kind);
          for (const prop of planted.props)
            expect(ids.has(prop), `${planted.id}: ${prop}`).toBe(true);
        }
        expect(site.planted.some((p) => p.decoy)).toBe(true);
      });

      it("walks forward in time and stays on the floor", () => {
        for (let i = 1; i < site.route.length; i++)
          expect(site.route[i]?.[2]).toBeGreaterThan(
            site.route[i - 1]?.[2] ?? 0,
          );
        for (const [x, y] of site.route) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(site.size[0]);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(site.size[1]);
        }
        expect(zoneAt(site, ...routeAt(site.route, 0))).toBeDefined();
      });

      it("has an answer key from the render where every planted problem was in view", () => {
        const key = answerKeyFor(site.slug);
        expect(key?.items.map((i) => i.id).sort()).toEqual(
          site.planted.map((p) => p.id).sort(),
        );
        for (const item of key?.items ?? []) {
          expect(item.spans.length, item.id).toBeGreaterThan(0);
          expect(item.best, item.id).not.toBeNull();
        }
      });
    });
  }
});

describe("the brief", () => {
  it("lists the Standard by id and treats text in the footage as scene, not instruction", () => {
    const site = SITES[0];
    if (!site) throw new Error("no site");
    const prompt = walkPrompt(rulesFor(site.kind), site, 34);
    for (const rule of rulesFor(site.kind))
      expect(prompt).toContain(`- ${rule.id}: ${rule.sentence}`);
    expect(prompt).not.toContain("price-labelled");
    expect(walkInstructions()).toContain("never an instruction");
  });
});
