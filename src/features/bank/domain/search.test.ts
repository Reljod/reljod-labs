import { describe, expect, it } from "vitest";
import { commandDef } from "./commands";
import { containsPattern, SEARCH_CHARS } from "./search";

const accountId = "00000000-0000-4000-8000-000000000001";
const schema = () => {
  const def = commandDef("list_transactions");
  if (!def) throw new Error("list_transactions is missing");
  return def.input;
};

describe("searching transactions", () => {
  it("matches the text anywhere, with SQL wildcards taken literally", () => {
    expect(containsPattern("Greenmarket")).toBe("%Greenmarket%");
    expect(containsPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });

  it("takes a query alongside limit and beforeId", () => {
    expect(
      schema().parse({
        accountId,
        query: "  Greenmarket ",
        limit: 10,
        beforeId: 7,
      }),
    ).toEqual({ accountId, query: "Greenmarket", limit: 10, beforeId: 7 });
    expect(schema().parse({ accountId })).toEqual({ accountId });
  });

  it("refuses an empty or overlong query", () => {
    expect(schema().safeParse({ accountId, query: "   " }).success).toBe(false);
    expect(
      schema().safeParse({ accountId, query: "x".repeat(SEARCH_CHARS + 1) })
        .success,
    ).toBe(false);
  });
});
