import { describe, expect, it, vi } from "vitest";

vi.mock("./steps", () => ({}));

import { shown } from "./workflow";

describe("what a person is told about a failure", () => {
  it("extracts safe error messages even when wrapped in a workflow step prefix", () => {
    expect(
      shown(
        new Error(
          'Step "step//./src/features/loupe/server/steps//prepareStep" failed after 1 retry: The Document could not be opened: The Sandbox could not run the command.',
        ),
      ),
    ).toBe(
      "The Document could not be opened: The Sandbox could not run the command.",
    );
    expect(
      shown(
        new Error(
          'Step "step//./src/features/loupe/server/steps//prepareStep" failed after 1 retry: The Sample\'s file could not be read.',
        ),
      ),
    ).toBe("The Sample's file could not be read.");
    expect(shown(new Error("postgres connection exploded"))).toBe(
      "The Examination failed on our side.",
    );
  });
  it("does not pick a known phrase out of the middle of an internal error", () => {
    expect(shown(new Error("insert failed for The Upload table"))).toBe(
      "The Examination failed on our side.",
    );
  });
});
