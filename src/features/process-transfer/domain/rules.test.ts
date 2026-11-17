import { describe, expect, it } from "vitest";
import { cleanOverrides, LOCKED_ON, resolveRules } from "./rules";

const rule = (overrides: unknown, id: string) => {
  const found = resolveRules(cleanOverrides(overrides)).find(
    (item) => item.id === id,
  );
  if (!found) throw new Error(id);
  return found;
};

describe("cleanOverrides", () => {
  it("never lets a minimum pass its maximum", () => {
    const steps = rule(
      { "process.step-count": { params: { min: 10, max: 5 } } },
      "process.step-count",
    );
    expect(steps.params.min).toBeLessThanOrEqual(steps.params.max);
    expect(steps.params).toEqual({ min: 10, max: 10 });

    const timing = rule(
      { "motion.timing": { params: { min: 600 } } },
      "motion.timing",
    );
    expect(timing.params).toEqual({ min: 600, max: 700 });

    const raised = rule(
      { "motion.timing": { params: { min: 600, max: 300 } } },
      "motion.timing",
    );
    expect(raised.params).toEqual({ min: 600, max: 600 });
  });

  it("keeps the Rules that may not be switched off on", () => {
    for (const id of LOCKED_ON) {
      expect(cleanOverrides({ [id]: { enabled: false } })).toEqual({});
      expect(rule({ [id]: { enabled: false } }, id).enabled).toBe(true);
    }
  });

  it("drops unknown Rules and Parameters, and clamps the rest", () => {
    expect(
      cleanOverrides({
        "no.such-rule": { enabled: false },
        "content.max-bullets": { params: { max: 99, colour: 3 } },
      }),
    ).toEqual({ "content.max-bullets": { params: { max: 8 } } });
    expect(cleanOverrides("nonsense")).toEqual({});
    expect(
      cleanOverrides({ "content.max-bullets": { params: { max: "4" } } }),
    ).toEqual({});
  });
});
