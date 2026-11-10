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

  it("lists each project once", () => {
    const slugs = featuredProjects.map((project) => project.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
