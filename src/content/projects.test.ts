import { describe, expect, it } from "vitest";
import { demoCount, demosPitch, liveDemos, projects } from "./projects";

describe("projects", () => {
  it("counts the live demos in words for the copy", () => {
    expect(demoCount.value).toBe(liveDemos.length);
    expect(demoCount.Word).toMatch(/^[A-Z]/);
    expect(demosPitch.figure).toBe(String(liveDemos.length));
    expect(demosPitch.body.startsWith(demoCount.Word)).toBe(true);
  });

  it("leads the landing page with the Harness, the rest in list order", () => {
    expect(liveDemos.map((project) => project.slug)).toEqual([
      "bank-harness",
      "document-compliance-checks",
      "ledger",
      "casework-desk",
      "client-manager",
      "process-transfer",
      "name-extraction",
      "operator",
      "tidewater-bank",
      "loupe",
      "switchboard",
      "canvas",
      "vellum",
    ]);
  });

  it("marks the Harness, Handover and Sieve as new, and only the Harness, the first live demo, as beta", () => {
    const marked = (mark: "New" | "Beta") =>
      projects.filter((p) => p.marks?.includes(mark)).map((p) => p.slug);
    expect(marked("New")).toEqual([
      "process-transfer",
      "bank-harness",
      "name-extraction",
      "operator",
      "tidewater-bank",
      "loupe",
      "switchboard",
      "canvas",
      "vellum",
    ]);
    expect(marked("Beta")).toEqual(["bank-harness"]);
    expect(liveDemos[0]?.slug).toBe("bank-harness");
  });

  it("lists each project once", () => {
    const slugs = projects.map((project) => project.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
