import { describe, expect, it } from "vitest";
import { diffStats, lineDiff } from "./diff";

describe("lineDiff", () => {
  it("marks identical text as all kept", () => {
    expect(lineDiff("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("finds a changed line in the middle", () => {
    const lines = lineDiff("a\nb\nc", "a\nB\nc");
    expect(lines).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
    ]);
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 });
  });

  it("finds inserted and deleted lines", () => {
    const lines = lineDiff("a\nb\nc\nd", "a\nx\nb\nd");
    expect(lines.filter((l) => l.kind === "add").map((l) => l.text)).toEqual([
      "x",
    ]);
    expect(lines.filter((l) => l.kind === "remove").map((l) => l.text)).toEqual(
      ["c"],
    );
    const rebuilt = lines.filter((l) => l.kind !== "remove").map((l) => l.text);
    expect(rebuilt).toEqual(["a", "x", "b", "d"]);
  });

  it("handles an empty side", () => {
    expect(lineDiff("", "a")).toEqual([{ kind: "add", text: "a" }]);
    expect(lineDiff("a", "")).toEqual([{ kind: "remove", text: "a" }]);
    expect(lineDiff("", "")).toEqual([]);
  });
});
