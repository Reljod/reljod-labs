import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Span } from "../domain/types";
import { parseDocument } from "./parsers";

vi.mock("server-only", () => ({}));

const PACKS = new URL(
  "../../../../fixtures/document-compliance/packs/",
  import.meta.url,
);
const read = (path: string) =>
  new Uint8Array(readFileSync(new URL(path, PACKS)));

/** Joined text with spaces removed: OCR spacing varies, the characters must not. */
const compact = (spans: Span[]) =>
  spans
    .map((span) => span.text)
    .join(" ")
    .replace(/\s+/g, "");

const boxesValid = (spans: Span[]) =>
  spans.every(
    ({ box }) =>
      0 <= box.x0 &&
      box.x0 < box.x1 &&
      box.x1 <= 1 &&
      0 <= box.y0 &&
      box.y0 < box.y1 &&
      box.y1 <= 1,
  );

// Real parsers on the synthetic packs: slow (OCR) but local and free. The first
// run downloads Tesseract's English data.
describe("parseDocument on the preset packs", { timeout: 120_000 }, () => {
  it("reads the bill's text layer", async () => {
    const parsed = await parseDocument({
      file: read("clean/proof-of-address.pdf"),
      sourceFormat: "pdf_digital",
      pageImages: [],
    });
    expect(parsed).toMatchObject({ parser: "pdfjs", pageCount: 1 });
    const text = parsed.spans.map((span) => span.text).join(" ");
    expect(text).toContain("Amara L. Velasco");
    expect(text).toContain("02 Oct 2026");
    expect(boxesValid(parsed.spans)).toBe(true);
  });

  it("OCRs the passport, including the real expiry in the MRZ", async () => {
    const parsed = await parseDocument({
      file: read("tampered-passport/identity-document.jpg"),
      sourceFormat: "image",
      pageImages: [],
    });
    expect(parsed).toMatchObject({ parser: "tesseract", pageCount: 1 });
    const text = compact(parsed.spans);
    expect(text).toContain("VELASCO");
    expect(text).toContain("11SEP2029");
    expect(text).toContain("2509116");
    expect(boxesValid(parsed.spans)).toBe(true);
  });

  it("OCRs the scanned certification from its page image", async () => {
    const parsed = await parseDocument({
      file: read("clean/certified-copy.pdf"),
      sourceFormat: "pdf_scanned",
      pageImages: [read("clean/certified-copy.page-1.png")],
    });
    expect(parsed).toMatchObject({ parser: "tesseract", pageCount: 1 });
    const text = compact(parsed.spans);
    expect(text).toContain("DanielK.Ortez");
    expect(text).toContain("NotaryPublic");
    expect(text).toContain("20Oct2026");
  });
});
