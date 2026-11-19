import { describe, expect, it } from "vitest";
import {
  FEATURED_PROJECT_LIMIT,
  featuredProjects,
  liveDemos,
  projects,
} from "./projects";

describe("featuredProjects", () => {
  it("shows every live demo on the About page", () => {
    for (const demo of liveDemos) {
      expect(featuredProjects).toContain(demo);
    }
  });

  it("keeps the first entries in place so Ledger's source paths stay stable", () => {
    expect(featuredProjects.slice(0, FEATURED_PROJECT_LIMIT)).toEqual(
      projects.slice(0, FEATURED_PROJECT_LIMIT),
    );
  });

  it("ends with the live demos past the first entries, in list order", () => {
    expect(
      featuredProjects
        .slice(FEATURED_PROJECT_LIMIT)
        .map((project) => project.slug),
    ).toEqual([
      "ledger",
      "casework-desk",
      "client-manager",
      "process-transfer",
      "bank-harness",
      "name-extraction",
      "canvas",
    ]);
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
      "canvas",
    ]);
  });

  it("marks the Harness, Handover and Sieve as new, and only the Harness, the first live demo, as beta", () => {
    const marked = (mark: "New" | "Beta") =>
      projects.filter((p) => p.marks?.includes(mark)).map((p) => p.slug);
    expect(marked("New")).toEqual([
      "process-transfer",
      "bank-harness",
      "name-extraction",
      "canvas",
    ]);
    expect(marked("Beta")).toEqual(["bank-harness"]);
    expect(liveDemos[0]?.slug).toBe("bank-harness");
  });

  it("lists each project once", () => {
    const slugs = featuredProjects.map((project) => project.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
