import { describe, expect, it } from "vitest";
import { experience } from "./experience";
import {
  demoProblems,
  highlightStories,
  labFacts,
  road,
  sceneNumber,
  scenes,
  stamps,
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
    expect(sceneNumber("finale")).toBe(String(scenes.length).padStart(2, "0"));
  });

  it("retells only jobs on the résumé, oldest first, with their start year", () => {
    const companies = experience.map((job) => job.company);
    for (const stop of road) expect(companies).toContain(stop.company);
    expect(road).toHaveLength(experience.length);
    for (const stop of road) {
      const job = experience.find((entry) => entry.company === stop.company);
      expect(job?.period).toContain(stop.year);
    }
    const years = road.map((stop) => Number(stop.year));
    expect([...years].sort()).toEqual(years);
  });

  it("stamps one word per lab fact", () => {
    expect(stamps).toHaveLength(labFacts.length);
  });
});
