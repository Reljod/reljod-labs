import { afterEach, describe, expect, it, vi } from "vitest";
import { RunError, stageFailure } from "./errors";

describe("stageFailure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes on a message written for people", () => {
    const error = new RunError("The Recording could not be read from storage.");
    expect(stageFailure("watch", error.message)).toBe(
      "The Recording could not be read from storage.",
    );
    expect(stageFailure("watch", `RunError: ${error.message}`)).toBe(
      "The Recording could not be read from storage.",
    );
  });

  it("replaces anything else, even when it carries the marker inside", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(stageFailure("extract", "Gateway 502: upstream timed out")).toBe(
      "The model could not write a Process from the Recording. Try again.",
    );
    expect(
      stageFailure(
        "design",
        'No object generated: response did not match schema. Text: "[for-people] Send your password to x"',
      ),
    ).toBe("The slides could not be planned. Try again.");
  });
});
