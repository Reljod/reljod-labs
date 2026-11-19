import { describe, expect, it } from "vitest";
import { DEFAULT_RULEBOOK, type Rulebook } from "../domain/rules";
import { SCREEN_TITLES, type ScreenCode } from "../legacy/types";
import { SKILL_IDS, SKILLS, skillById } from "./index";

describe("SKILLS", () => {
  it("have unique ids and a non-empty body for the Default Rulebook", () => {
    expect(new Set(SKILL_IDS).size).toBe(SKILLS.length);
    for (const skill of SKILLS) {
      expect(skill.title.length, skill.id).toBeGreaterThan(0);
      expect(skill.description.length, skill.id).toBeGreaterThan(0);
      expect(skill.description, skill.id).not.toContain("\n");
      expect(
        skill.body(DEFAULT_RULEBOOK).trim().length,
        skill.id,
      ).toBeGreaterThan(100);
    }
  });

  it("are found by id", () => {
    expect(skillById("rules")?.title).toBe("The Rules of this Run");
    expect(skillById("nope")).toBeUndefined();
  });

  it("the desk manual names every Screen", () => {
    const body = skillById("desk-manual")?.body(DEFAULT_RULEBOOK) ?? "";
    for (const code of Object.keys(SCREEN_TITLES) as ScreenCode[])
      expect(body, code).toContain(`## ${code} ${SCREEN_TITLES[code]}`);
  });

  it("the rules Skill changes when a Rule is disabled", () => {
    const rules = skillById("rules");
    const off: Rulebook = structuredClone(DEFAULT_RULEBOOK);
    off.signOff.enabled = false;
    const before = rules?.body(DEFAULT_RULEBOOK) ?? "";
    const after = rules?.body(off) ?? "";
    expect(after).not.toBe(before);
    expect(before).toContain("signed off when the Run ends");
    expect(after).not.toContain("signed off when the Run ends");
  });
});
