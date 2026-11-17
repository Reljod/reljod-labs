import { describe, expect, it } from "vitest";
import {
  parseSkillMd,
  renderSkillMd,
  SKILL_DEFAULTS,
  SKILL_LIMITS,
  type SkillDefault,
  type SkillText,
  skillProblems,
  skillView,
} from "./skills";

const skill: SkillText = {
  name: "member-request",
  description:
    'Use when a Member asks to transfer out, withdraw or retire: runs the "member_request" Pipeline.',
  body: "# Member requests\n\n1. Find the Member.\n2. Start the Run.",
};

describe("renderSkillMd", () => {
  it("writes frontmatter with name and description, then the body", () => {
    const text = renderSkillMd(skill);
    expect(text.startsWith("---\nname: member-request\ndescription: ")).toBe(
      true,
    );
    expect(text).toContain("\n---\n\n# Member requests\n");
    expect(text.endsWith("Start the Run.\n")).toBe(true);
  });

  it("quotes a description YAML would misread", () => {
    expect(renderSkillMd(skill)).toContain(
      `description: ${JSON.stringify(skill.description)}`,
    );
    expect(
      renderSkillMd({ ...skill, description: "Answers plan questions" }),
    ).toContain("description: Answers plan questions\n");
    expect(renderSkillMd({ ...skill, description: "yes" })).toContain(
      'description: "yes"',
    );
  });

  it("reads back what it wrote", () => {
    for (const description of [
      skill.description,
      "Plain words, with commas (and brackets)",
      "Colon: inside # and a hash",
      "It's quoted 'here'",
      "true",
    ]) {
      const parsed = parseSkillMd(renderSkillMd({ ...skill, description }));
      expect(parsed).toEqual({ ok: true, skill: { ...skill, description } });
    }
  });
});

describe("parseSkillMd", () => {
  it("reads plain, quoted and run-on values and ignores other keys", () => {
    const parsed = parseSkillMd(
      [
        "---",
        "name: 'plan-answers'",
        "license: MIT",
        "description: Answers a Member's question",
        "  from the Knowledge base.",
        "---",
        "Body here.",
        "",
        "--- not frontmatter",
      ].join("\r\n"),
    );
    expect(parsed).toEqual({
      ok: true,
      skill: {
        name: "plan-answers",
        description: "Answers a Member's question from the Knowledge base.",
        body: "Body here.\n\n--- not frontmatter",
      },
    });
  });

  it("says what is missing", () => {
    expect(parseSkillMd("# Just markdown")).toMatchObject({ ok: false });
    expect(parseSkillMd("---\nname: a\n")).toMatchObject({ ok: false });
    expect(parseSkillMd("---\nname: a\n---\nbody")).toEqual({
      ok: false,
      error: "The frontmatter needs a description.",
    });
    expect(parseSkillMd("---\ndescription: d\n---\nbody")).toEqual({
      ok: false,
      error: "The frontmatter needs a name.",
    });
    expect(parseSkillMd('---\nname: "unclosed\n---\n')).toMatchObject({
      ok: false,
    });
  });
});

describe("skillProblems", () => {
  it("passes a well-formed Skill", () => {
    expect(skillProblems(skill)).toEqual([]);
  });

  it("holds the name to lowercase-hyphen and 64 characters", () => {
    for (const name of ["", "Member Request", "member_request", "-a", "a--b"]) {
      expect(skillProblems({ ...skill, name })[0]?.field).toBe("name");
    }
    expect(
      skillProblems({ ...skill, name: "a".repeat(SKILL_LIMITS.nameChars + 1) }),
    ).toHaveLength(1);
    expect(
      skillProblems({ ...skill, name: "a".repeat(SKILL_LIMITS.nameChars) }),
    ).toEqual([]);
  });

  it("holds the description to one line of 1024 characters", () => {
    expect(skillProblems({ ...skill, description: " " })[0]?.field).toBe(
      "description",
    );
    expect(
      skillProblems({ ...skill, description: "two\nlines" })[0]?.field,
    ).toBe("description");
    expect(
      skillProblems({
        ...skill,
        description: "d".repeat(SKILL_LIMITS.descriptionChars + 1),
      }),
    ).toHaveLength(1);
  });

  it("needs a body", () => {
    expect(skillProblems({ ...skill, body: "  \n" })[0]?.field).toBe("body");
  });
});

describe("skillView", () => {
  const base: SkillDefault = { ...skill, id: "member-request", kind: "skill" };
  const saved = {
    version: 2,
    savedBy: { id: "s1", name: "Marva" },
    createdAt: "2026-11-17T00:00:00.000Z",
  };

  it("shows the Default as Version 0, not edited", () => {
    expect(skillView(base, null)).toMatchObject({
      version: 0,
      edited: false,
      body: skill.body,
      pipelineId: null,
      savedBy: null,
    });
  });

  it("shows the latest Version and that it differs from the Default", () => {
    const view = skillView(base, { ...skill, body: "Changed.", ...saved });
    expect(view).toMatchObject({ version: 2, edited: true, body: "Changed." });
    expect(view.default.body).toBe(skill.body);
  });

  it("is not edited once a Version puts the Default back", () => {
    expect(skillView(base, { ...skill, ...saved }).edited).toBe(false);
  });
});

describe("SKILL_DEFAULTS", () => {
  it("ships only well-formed Skills, keyed by id", () => {
    for (const [id, item] of Object.entries(SKILL_DEFAULTS)) {
      expect(item.id).toBe(id);
      expect(skillProblems(item)).toEqual([]);
    }
  });
});
