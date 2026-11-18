import { describe, expect, it } from "vitest";
import {
  demoProblems,
  deskPages,
  highlightStories,
  sceneNumber,
  scenes,
} from "./landing";
import { highlights } from "./profile";
import { liveDemos } from "./projects";

describe("landing copy", () => {
  it("puts every live demo as a plain problem, and no demo that isn't live", () => {
    expect(Object.keys(demoProblems).sort()).toEqual(
      liveDemos.map((demo) => demo.slug).sort(),
    );
  });

  it("tells a story for every highlight on the profile", () => {
    expect(Object.keys(highlightStories).sort()).toEqual(
      highlights.map((metric) => metric.label).sort(),
    );
  });

  it("numbers scenes in page order, with unique ids", () => {
    expect(new Set(scenes.map((scene) => scene.id)).size).toBe(scenes.length);
    expect(sceneNumber("top")).toBe("01");
    expect(sceneNumber("contact")).toBe(String(scenes.length).padStart(2, "0"));
  });
});

describe("desk pages", () => {
  it("gives every page five lines and three notes, so it fits the stage", () => {
    for (const page of deskPages) {
      expect(page.lines).toHaveLength(5);
      expect(page.lines.filter((line) => line.note)).toHaveLength(3);
    }
  });
});
