import { describe, expect, it } from "vitest";
import { DEFAULT_RULEBOOK, SKILL_IDS } from "../../domain/contract";
import { SKILLS } from "../../skills";
import {
  analystInstructions,
  READER_INSTRUCTIONS,
  readerPages,
  renderRulebook,
} from "./prompt";

describe("renderRulebook", () => {
  it("states every rule, with the version", () => {
    const text = renderRulebook(DEFAULT_RULEBOOK, 3);
    expect(text).toMatch(/^Rulebook version 3:/);
    expect(text).toContain('"Meridia Central Bank"');
    expect(text).toContain("Fold aliases");
    expect(text).toContain("nothing is dropped for low confidence");
    for (const instruction of DEFAULT_RULEBOOK.instructions)
      expect(text).toContain(instruction);
  });

  it("follows the switches", () => {
    const text = renderRulebook(
      {
        ...DEFAULT_RULEBOOK,
        entityTypes: ["person"],
        resolveAliases: false,
        includeHandles: false,
        includeOfficials: false,
        dropBelow: 0.2,
        exclude: [],
        instructions: [],
      },
      1,
    );
    expect(text).toContain("Do not extract organization");
    expect(text).toContain("Do not fold aliases");
    expect(text).toContain("Ignore parties that appear only in email");
    expect(text).toContain("Do not extract officials");
    expect(text).toContain("below 0.2 it is dropped");
    expect(text).toContain("No exclusions");
  });
});

describe("analystInstructions", () => {
  const text = analystInstructions(DEFAULT_RULEBOOK, 0);

  it("lists each Skill in one line, not its playbook", () => {
    for (const id of SKILL_IDS) {
      expect(text).toContain(`- ${id}: ${SKILLS[id].description}`);
      expect(text).not.toContain(SKILLS[id].body.slice(0, 200));
    }
  });

  it("states the goal, the Done gate and the Rulebook", () => {
    expect(text).toContain("recall first");
    expect(text).toContain("# The Done gate");
    expect(text).toContain("Rulebook version 0");
  });

  it("is stable for the same Rulebook, so it caches", () => {
    expect(analystInstructions(DEFAULT_RULEBOOK, 0)).toBe(text);
  });
});

describe("Readers' prompt", () => {
  it("asks for verbatim quotes", () => {
    expect(READER_INSTRUCTIONS).toContain("EXACTLY as printed");
  });

  it("puts the focus before the pages and numbers each page", () => {
    const text = readerPages(
      [
        { page: 4, text: "first" },
        { page: 5, text: "second" },
      ],
      "signature blocks",
    );
    expect(text.indexOf("Focus")).toBeLessThan(text.indexOf("=== Page 4 ==="));
    expect(text).toContain("Pages 4-5:");
    expect(text).toContain("=== Page 5 ===\nsecond");
  });
});
