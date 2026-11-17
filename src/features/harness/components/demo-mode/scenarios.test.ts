import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RULE_SPECS } from "../../domain/rules/defaults";
import { sampleById } from "../../domain/samples";
import { SEED_STAFF } from "../../domain/staff";
import { SCENARIOS } from "./scenarios";

describe("Scenarios", () => {
  it("have unique ids, and every Beat has an id and a line", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const scenario of SCENARIOS) {
      expect(scenario.beats.length).toBeGreaterThan(2);
      expect(new Set(scenario.beats.map((b) => b.id)).size).toBe(
        scenario.beats.length,
      );
      for (const beat of scenario.beats) {
        expect(beat.say.length).toBeGreaterThan(20);
        expect(typeof beat.run).toBe("function");
      }
    }
  });

  it("names only the Staff keys, samples and Rules that exist", () => {
    // Beats are functions, so the ids they name are read from the module's own text.
    const text = readFileSync(
      new URL("./scenarios.ts", import.meta.url),
      "utf8",
    );
    for (const [, id] of text.matchAll(
      /(?:attach|uploadKnowledge)\("([^"]+)"\)/g,
    )) {
      expect(sampleById(id as string), id).toBeDefined();
    }
    for (const [, id] of text.matchAll(/memberRequestPlan\(\s*"([^"]+)"/g)) {
      expect(sampleById(id as string), id).toBeDefined();
    }
    for (const [, id] of text.matchAll(/schedulePlan\(\s*"([^"]+)"/g)) {
      expect(sampleById(id as string), id).toBeDefined();
    }
    const keys = SEED_STAFF.map((s) => s.key);
    for (const [, key] of text.matchAll(
      /const (?:OFFICER|MANAGER) = "([^"]+)"/g,
    )) {
      expect(keys).toContain(key);
    }
    const ruleIds = [...text.matchAll(/ABSENCE_RULE = "([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(ruleIds).toEqual(["mr.overseas-absence"]);
    const rule = RULE_SPECS.find((r) => r.id === ruleIds[0]);
    expect(rule?.params.minYears).toBeDefined();
    expect(text).toContain('setParameter("minYears", 1)');
  });

  it("every Beat that expects a Run has a way on when the Agent does not start one", () => {
    for (const scenario of SCENARIOS) {
      for (const beat of scenario.beats) {
        if (beat.settle?.kind === "run-started") {
          expect(
            beat.onDrift?.askAgain.length,
            `${scenario.id}/${beat.id}`,
          ).toBeGreaterThan(10);
        }
      }
    }
  });
});
