import { describe, expect, it } from "vitest";
import { citedRefs, handleOf, refOf, splitCitations } from "./citations";

const ID = "3f9a12bc-1111-4222-8333-444455556666";

describe("citations", () => {
  it("names a client by the first 8 characters of its id", () => {
    expect(handleOf(ID)).toBe("3f9a12bc");
    expect(refOf(ID, "person:ivy-marsh")).toBe("3f9a12bc/person:ivy-marsh");
  });

  it("splits an answer into text and book-wide citations", () => {
    expect(
      splitCitations("Ivy [[3f9a12bc/person:ivy-marsh]] holds it."),
    ).toEqual([
      { kind: "text", text: "Ivy " },
      { kind: "cite", handle: "3f9a12bc", key: "person:ivy-marsh" },
      { kind: "text", text: " holds it." },
    ]);
  });

  it("still reads a bare Key, for a chat about one client", () => {
    expect(splitCitations("[[client]] and [[account:isa-1]]")).toEqual([
      { kind: "cite", handle: null, key: "client" },
      { kind: "text", text: " and " },
      { kind: "cite", handle: null, key: "account:isa-1" },
    ]);
  });

  it("lists each citation once, keeping clients apart", () => {
    expect(
      citedRefs(
        "[[3f9a12bc/client]] [[3f9a12bc/client]] [[aaaaaaaa/client]] [[not a cite]]",
      ),
    ).toEqual([
      { handle: "3f9a12bc", key: "client" },
      { handle: "aaaaaaaa", key: "client" },
    ]);
  });
});
