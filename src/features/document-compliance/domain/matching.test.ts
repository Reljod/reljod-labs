import { describe, expect, it } from "vitest";
import { addressesCompatible, namesCompatible } from "./matching";

const declared = "Amara Lucia Velasco";

describe("namesCompatible", () => {
  it.each([
    "AMARA LUCIA VELASCO",
    "VELASCO, AMARA LUCIA",
    "Amara L. Velasco",
    "A. Velasco",
    "Amara Velasco",
  ])("accepts %s", (name) => {
    expect(namesCompatible(name, declared)).toBe(true);
  });

  it("ignores accents", () => {
    expect(namesCompatible("José Núñez", "Jose Nunez")).toBe(true);
  });

  it.each([
    "Marisol Velasco",
    "Amara Lucia Reyes",
    "Velasco",
  ])("rejects %s", (name) => {
    expect(namesCompatible(name, declared)).toBe(false);
  });
});

describe("addressesCompatible", () => {
  const address =
    "14 Harbour View Road, Port Selene MR-2041, Republic of Meridia";

  it("accepts the same address split over lines", () => {
    expect(
      addressesCompatible(
        "14 Harbour View Road\nPort Selene MR-2041\nRepublic of Meridia",
        address,
      ),
    ).toBe(true);
  });

  it("rejects a different house number", () => {
    expect(
      addressesCompatible("41 Harbour View Road, Port Selene MR-2041", address),
    ).toBe(false);
  });
});
