import { describe, expect, it } from "vitest";
import { looksLike, storedProblem, ticketExpired, UPLOADS } from "./uploads";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("looksLike", () => {
  it("knows each accepted type by its first bytes", () => {
    expect(looksLike(text("%PDF-1.7\n"), "application/pdf")).toBe(true);
    expect(
      looksLike(bytes(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10), "image/png"),
    ).toBe(true);
    expect(looksLike(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
    expect(looksLike(text("name,amount\nA,1\n"), "text/csv")).toBe(true);
  });

  it("refuses a file that is not what its type says", () => {
    expect(looksLike(text("<html>"), "application/pdf")).toBe(false);
    expect(looksLike(text("%PDF-1.7"), "image/jpeg")).toBe(false);
    expect(looksLike(text("%PDF-1.7"), "text/csv")).toBe(false);
    expect(looksLike(bytes(0x4d, 0x5a, 0, 0), "text/csv")).toBe(false);
    expect(looksLike(new Uint8Array(), "text/csv")).toBe(false);
    expect(looksLike(text("%PDF-1.7"), "application/x-msdownload")).toBe(false);
  });
});

describe("storedProblem", () => {
  const pdf = text("%PDF-1.7");
  it("accepts a stored file within the cap", () => {
    expect(storedProblem({ size: 1000, head: pdf }, "application/pdf")).toBe(
      null,
    );
  });

  it("refuses a missing, empty, oversized or mistyped object", () => {
    expect(storedProblem(null, "application/pdf")).toMatch(/not uploaded/);
    expect(storedProblem({ size: 0, head: pdf }, "application/pdf")).toMatch(
      /empty/,
    );
    expect(
      storedProblem(
        { size: UPLOADS.maxBytes + 1, head: pdf },
        "application/pdf",
      ),
    ).toMatch(/over 10 MB/);
    expect(storedProblem({ size: 10, head: pdf }, "image/png")).toMatch(/type/);
  });
});

describe("ticketExpired", () => {
  it("accepts a ticket until its time is up, and refuses one with none", () => {
    expect(ticketExpired(2000, 1000)).toBe(false);
    expect(ticketExpired(1000, 1000)).toBe(true);
    expect(ticketExpired(undefined, 1000)).toBe(true);
    expect(ticketExpired("9999999999999", 1000)).toBe(true);
  });
});
