import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { withoutTitle } = await import("./model");

describe("withoutTitle", () => {
  const title = "Transfer instruction: Leaving Cayman · HB-10042";

  it("drops a first line that only repeats the title, in bold or as a heading", () => {
    expect(withoutTitle(`**${title}**\n\nTo the Payments Team,`, title)).toBe(
      "To the Payments Team,",
    );
    expect(withoutTitle(`## ${title}\nDear Sir`, title)).toBe("Dear Sir");
  });

  it("keeps the text when the first line says something else", () => {
    expect(withoutTitle("  Dear Ms Fairweather-Kent,\n\nWe have…", title)).toBe(
      "Dear Ms Fairweather-Kent,\n\nWe have…",
    );
  });
});
