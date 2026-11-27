import { describe, expect, it } from "vitest";
import { resolveRules } from "../../domain/rules";
import { draftFrom, ruleDef, toOverride } from "./rule-form";

const rules = resolveRules();
const byId = (id: string) => {
  const rule = rules.find((item) => item.id === id);
  const def = ruleDef(id);
  if (!rule || !def) throw new Error(id);
  return { rule, def };
};

describe("toOverride sends the whole override, against the defaults", () => {
  // The server replaces a Rule's stored override with exactly what it gets,
  // so anything the form leaves out is lost.
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
