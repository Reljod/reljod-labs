import { describe, expect, it } from "vitest";
import type { FieldReading, Span } from "./types";
import { verifyReading } from "./verify";

function span(ref: string, text: string): Span {
  return {
    ref,
    page: 1,
    text,
    granularity: "line",
    box: { x0: 0, y0: 0, x1: 1, y1: 1 },
    confidence: 0.99,
  };
}

const spans = [
  span("p1-s1", "VELASCO"),
  span("p1-s2", "AMARA LUCIA"),
  span("p1-s3", "MR48201732MRD9103144F2509116<<<<<<<<<<<<<<06"),
];

function reading(value: string, spanRefs: string[]): FieldReading {
  return { name: "full_name", value, spanRefs, confidence: 0.95 };
}

describe("verifyReading", () => {
  it("accepts a value assembled from several spans", () => {
    expect(
      verifyReading(reading("AMARA LUCIA VELASCO", ["p1-s2", "p1-s1"]), spans)
        .verified,
    ).toBe(true);
  });

  it("accepts a value packed inside an MRZ line", () => {
    expect(verifyReading(reading("250911", ["p1-s3"]), spans).verified).toBe(
      true,
    );
  });

  it("rejects a value the cited spans do not contain", () => {
    expect(
      verifyReading(reading("MARISOL VELASCO", ["p1-s1"]), spans).verified,
    ).toBe(false);
  });

  it("rejects an unknown span reference", () => {
    expect(verifyReading(reading("VELASCO", ["p9-s9"]), spans).verified).toBe(
      false,
    );
  });

  it("rejects a reading that cites no spans", () => {
    expect(verifyReading(reading("VELASCO", []), spans).verified).toBe(false);
  });
});
