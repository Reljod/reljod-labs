import { describe, expect, it } from "vitest";
import { baseBooks } from "../legacy/base-books";
import { diffBooks } from "../legacy/books";
import { evaluate } from "./checks";
import { DEFAULT_RULEBOOK } from "./rules";

describe("the checks on an own Task", () => {
  const before = baseBooks();

  function run(after = baseBooks()) {
    return evaluate({
      rulebook: DEFAULT_RULEBOOK,
      expected: null,
      manifest: null,
      changes: diffBooks(before, after),
      after,
      signedOn: false,
      screens: ["HMS000", "HMM100"],
      approved: [],
      byHand: false,
    });
  }

  it("says so when nothing changed, and stays unverified", () => {
    const result = run();
    expect(result.verdict).toBe("unverified");
    expect(result.findings).toContainEqual({
      id: "task.outcome",
      level: "info",
      title: "Nothing in the Books changed",
    });
  });

  it("lists each change for the person to judge, with the fields of an amend", () => {
    const after = baseBooks();
    const line = after.lines[0];
    after.lines[0] = { ...line, grossKg: line.grossKg + 1 };
    const result = run(after);
    const listed = result.findings.filter(
      (finding) => finding.id === "task.outcome",
    );
    expect(listed).toHaveLength(1);
    expect(listed[0].level).toBe("info");
    expect(listed[0].title).toContain("Amend a manifest line");
    expect(listed[0].detail).toBe(
      `grossKg: "${line.grossKg}" to "${line.grossKg + 1}"`,
    );
    // Nothing to compare it with, so code does not call it correct.
    expect(result.verdict).toBe("unverified");
  });
});
