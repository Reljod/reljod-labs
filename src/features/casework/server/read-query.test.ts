import { describe, expect, it } from "vitest";
import { MAX_PAGE_IDS } from "../domain/api";
import { parseDocumentIds } from "./read-query";

const a = "0b6f1c2e-6d0a-4c49-9a57-2f1f3f0b9a01";
const b = "6a1e0d8c-1f2b-4b3c-8d4e-5f6a7b8c9d02";

describe("parseDocumentIds", () => {
  it("reads comma-separated ids, once each", () => {
    expect(parseDocumentIds(`${a},${b},${a}`)).toEqual([a, b]);
    expect(parseDocumentIds(` ${a} ,`)).toEqual([a]);
  });

  it("refuses a missing, empty or malformed list", () => {
    expect(parseDocumentIds(null)).toBeNull();
    expect(parseDocumentIds("")).toBeNull();
    expect(parseDocumentIds(",")).toBeNull();
    expect(parseDocumentIds(`${a},not-an-id`)).toBeNull();
    expect(parseDocumentIds("x' or 1=1--")).toBeNull();
  });

  it("refuses more than a request may ask for", () => {
    const many = Array.from(
      { length: MAX_PAGE_IDS + 1 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(parseDocumentIds(many.join(","))).toBeNull();
    expect(
      parseDocumentIds(many.slice(0, MAX_PAGE_IDS).join(",")),
    ).toHaveLength(MAX_PAGE_IDS);
  });
});
