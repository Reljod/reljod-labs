import { describe, expect, it } from "vitest";
import {
  fileStem,
  kindOf,
  sourceStorageKey,
  storedExtension,
  titleFromName,
} from "./file-kind";

describe("kindOf", () => {
  it("goes by the extension first", () => {
    expect(kindOf("Circular.PDF", "")).toBe("pdf");
    expect(kindOf("fees.xlsx", "application/octet-stream")).toBe("sheet");
    expect(kindOf("table.csv", "application/vnd.ms-excel")).toBe("csv");
    expect(kindOf("notes.md", "")).toBe("text");
    expect(kindOf("letter.docx", "")).toBe("doc");
  });

  it("falls back to the media type only when the name has no extension", () => {
    expect(kindOf("README", "text/plain; charset=utf-8")).toBe("text");
    expect(kindOf("scan", "application/pdf")).toBe("pdf");
  });

  it("refuses what it does not read, whatever the type claims", () => {
    expect(kindOf("run.exe", "application/pdf")).toBeNull();
    expect(kindOf("photo.png", "image/png")).toBeNull();
    expect(kindOf("noext", "application/zip")).toBeNull();
  });
});

describe("storage keys", () => {
  const owner = "host:11111111-2222-3333-4444-555555555555" as const;
  const sourceId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("builds the key from the Owner, the Source id, a slug and a fixed extension", () => {
    expect(
      sourceStorageKey({
        owner,
        sourceId,
        name: "Pensions Circular 2023-07.PDF",
        kind: "pdf",
      }),
    ).toBe(
      "owners/host-11111111-2222-3333-4444-555555555555/sources/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/pensions-circular-2023-07.pdf",
    );
  });

  it("never lets a path, dots or odd characters in a name reach the key", () => {
    for (const name of [
      "a./../x.pdf",
      "../../etc/passwd.pdf",
      "x\u0000y.pdf",
      "..pdf",
      "C:\\temp\\a b.pdf",
      "%2e%2e/a.pdf",
    ]) {
      const key = sourceStorageKey({ owner, sourceId, name, kind: "pdf" });
      const tail = key.split(`${sourceId}/`)[1] ?? "";
      expect(tail).toMatch(/^[a-z0-9-]+\.pdf$/);
      expect(key).not.toContain("..");
      expect(key.split("/")).toHaveLength(5);
    }
  });

  it("uses the extension of the kind, not the one in the name", () => {
    expect(storedExtension("pdf", "evil.html")).toBe("pdf");
    expect(storedExtension("sheet", "a.xls")).toBe("xlsx");
    expect(storedExtension("text", "a.markdown")).toBe("md");
    expect(storedExtension("text", "a.weird")).toBe("txt");
  });

  it("falls back to a stem when the name has no letters", () => {
    expect(fileStem("???.pdf")).toBe("source");
  });

  it("refuses an Owner or a Source id with nothing left", () => {
    expect(() =>
      sourceStorageKey({ owner, sourceId: "///", name: "a.pdf", kind: "pdf" }),
    ).toThrow();
  });
});

describe("titleFromName", () => {
  it("makes a readable title from a file name", () => {
    expect(titleFromName("kb-circular_2023-07.pdf")).toBe(
      "kb-circular 2023-07",
    );
    expect(titleFromName("C:\\x\\Report.docx")).toBe("Report");
    expect(titleFromName(".pdf")).toBe(".pdf");
  });
});
