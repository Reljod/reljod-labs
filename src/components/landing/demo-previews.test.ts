import { describe, expect, it } from "vitest";
import { liveDemos } from "@/content/projects";
import { demoPreviews } from "./demo-previews";

describe("demo previews", () => {
  it("has a moving preview for every live demo", () => {
    expect(Object.keys(demoPreviews).sort()).toEqual(
      liveDemos.map((demo) => demo.slug).sort(),
    );
  });
});
