import { describe, expect, it } from "vitest";
import { resolveRules } from "../../domain/rules";
import {
  draftErrors,
  draftFrom,
  isDirty,
  previewRule,
  ruleDef,
  toOverride,
} from "./rule-form";

const rules = resolveRules();
const byId = (id: string) => {
  const rule = rules.find((item) => item.id === id);
  const def = ruleDef(id);
  if (!rule || !def) throw new Error(id);
  return { rule, def };
};

describe("toOverride", () => {
  it("sends only what differs from the default", () => {
    const { rule, def } = byId("process.step-count");
    const draft = draftFrom(rule);
    draft.params.max = "12";
    expect(toOverride(def, draft)).toEqual({ params: { max: 12 } });
  });

  it("is null when the draft is the default again", () => {
    const edited = resolveRules({
      "content.max-bullets": { params: { max: 3 }, severity: "warn" },
    }).find((item) => item.id === "content.max-bullets");
    const def = ruleDef("content.max-bullets");
    if (!edited || !def) throw new Error("missing");
    const draft = draftFrom(edited);
    expect(toOverride(def, draft)).toEqual({
      severity: "warn",
      params: { max: 3 },
    });
    draft.params.max = "4";
    draft.severity = "block";
    expect(toOverride(def, draft)).toBeNull();
  });

  it("never switches off a locked Rule", () => {
    const { rule, def } = byId("loop.max-rounds");
    const draft = { ...draftFrom(rule), enabled: false };
    expect(toOverride(def, draft)).toBeNull();
  });

  it("records switching a Rule off", () => {
    const { rule, def } = byId("content.speaker-notes");
    expect(toOverride(def, { ...draftFrom(rule), enabled: false })).toEqual({
      enabled: false,
    });
  });
});

describe("toOverride sends the whole override, against the defaults", () => {
  // The server replaces a Rule's stored override with exactly what it gets.
  it("one Parameter changed from the default", () => {
    const { rule, def } = byId("content.bullet-length");
    const draft = draftFrom(rule);
    draft.params.maxWords = "10";
    expect(toOverride(def, draft)).toEqual({ params: { maxWords: 10 } });
  });

  it("a Rule saved as warn, set back to block with one Parameter changed", () => {
    const saved = resolveRules({
      "content.bullet-length": { severity: "warn", params: { maxWords: 20 } },
    }).find((item) => item.id === "content.bullet-length");
    const def = ruleDef("content.bullet-length");
    if (!saved || !def) throw new Error("missing");
    const draft = { ...draftFrom(saved), severity: "block" as const };
    draft.params.maxWords = "12";
    expect(toOverride(def, draft)).toEqual({ params: { maxWords: 12 } });
  });

  it("keeps earlier saved changes the form still holds", () => {
    const saved = resolveRules({
      "layout.min-font-size": { enabled: false, params: { body: 14 } },
    }).find((item) => item.id === "layout.min-font-size");
    const def = ruleDef("layout.min-font-size");
    if (!saved || !def) throw new Error("missing");
    const draft = draftFrom(saved);
    draft.params.title = "30";
    expect(toOverride(def, draft)).toEqual({
      enabled: false,
      params: { body: 14, title: 30 },
    });
  });

  it("everything back to the default is null", () => {
    const saved = resolveRules({
      "content.bullet-length": { severity: "warn", params: { maxWords: 20 } },
    }).find((item) => item.id === "content.bullet-length");
    const def = ruleDef("content.bullet-length");
    if (!saved || !def) throw new Error("missing");
    const draft = { ...draftFrom(saved), severity: "block" as const };
    draft.params.maxWords = String(def.defaults.maxWords);
    expect(toOverride(def, draft)).toBeNull();
  });
});

describe("draftErrors", () => {
  it("rejects empty, out-of-range and off-step values", () => {
    const { rule, def } = byId("layout.safe-area");
    const draft = draftFrom(rule);
    draft.params.margin = "";
    expect(draftErrors(def, draft).margin).toBe("Enter a number.");
    draft.params.margin = "200";
    expect(draftErrors(def, draft).margin).toBe("Between 16 and 120.");
    draft.params.margin = "50";
    expect(draftErrors(def, draft).margin).toBe("In steps of 4.");
    draft.params.margin = "52";
    expect(draftErrors(def, draft)).toEqual({});
  });

  it("keeps a range the right way round", () => {
    const { rule, def } = byId("motion.timing");
    const draft = draftFrom(rule);
    draft.params.min = "600";
    draft.params.max = "300";
    expect(draftErrors(def, draft).max).toBeDefined();
  });

  it("accepts a default that is off the step grid", () => {
    const { rule, def } = byId("content.title-length");
    expect(draftErrors(def, draftFrom(rule))).toEqual({});
    const draft = draftFrom(rule);
    draft.params.maxChars = "47";
    expect(draftErrors(def, draft).maxChars).toBe("In steps of 5.");
    draft.params.maxChars = "45";
    expect(draftErrors(def, draft)).toEqual({});
  });

  it("accepts decimal steps", () => {
    const { rule, def } = byId("layout.contrast");
    const draft = draftFrom(rule);
    draft.params.ratio = "7.5";
    expect(draftErrors(def, draft)).toEqual({});
  });
});

describe("isDirty and previewRule", () => {
  it("compares against the saved Rule and previews the new numbers", () => {
    const { rule } = byId("content.bullet-length");
    const draft = draftFrom(rule);
    expect(isDirty(rule, draft)).toBe(false);
    draft.params.maxWords = "10";
    expect(isDirty(rule, draft)).toBe(true);
    expect(previewRule(rule, draft).params.maxWords).toBe(10);
  });
});
