import { afterEach, describe, expect, it, vi } from "vitest";
import { HelioInputError, publicMessage } from "./errors";

describe("publicMessage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes a known input error's own words through", () => {
    expect(
      publicMessage(new HelioInputError("That image is too large."), "x"),
    ).toBe("That image is too large.");
  });

  it("never sends an internal error's message to the browser, and logs it", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const internal = new Error(
      "connect ECONNREFUSED postgres://user:secret@db.internal:6543",
    );
    expect(publicMessage(internal, "Market shoot failed.")).toBe(
      "Market shoot failed.",
    );
    expect(publicMessage("boom", "Generation failed.")).toBe(
      "Generation failed.",
    );
    expect(log).toHaveBeenCalled();
  });
});
