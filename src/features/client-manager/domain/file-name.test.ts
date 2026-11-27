import { describe, expect, it } from "vitest";
import { isUploadedPortraitPath, safeExtension } from "./file-name";

describe("safeExtension", () => {
  it("keeps an ordinary extension, lower-cased", () => {
    expect(safeExtension("Statement.PDF", "bin")).toBe("pdf");
  });

  it("falls back when the name has no extension", () => {
    expect(safeExtension("statement", "bin")).toBe("bin");
    expect(safeExtension("statement.", "jpg")).toBe("jpg");
  });

  it("never lets a name steer the storage path", () => {
    expect(safeExtension("a./../../other/x", "bin")).toBe("otherx");
    expect(safeExtension("photo.j/p\\g", "jpg")).toBe("jpg");
    expect(safeExtension("x.averyveryverylongextension", "bin")).toBe(
      "averyver",
    );
  });
});

describe("isUploadedPortraitPath", () => {
  const id = "2f1c6a52-6a0b-4d8e-9a65-0e3c3b8f6e11";

  it("accepts the path the upload step hands out", () => {
    expect(
      isUploadedPortraitPath(
        id,
        `clients/${id}/portrait-uploaded-1764250000000.jpg`,
      ),
    ).toBe(true);
  });

  it("refuses another client's upload, a traversal or a different file", () => {
    const other = "9f1c6a52-6a0b-4d8e-9a65-0e3c3b8f6e11";
    for (const path of [
      `clients/${other}/portrait-uploaded-1764250000000.jpg`,
      `clients/${id}/portrait-uploaded-1764250000000.jpg/../../x`,
      `clients/${id}/portrait-uploaded-../sources/a.pdf`,
      `clients/${id}/portrait-uploaded-1764250000000`,
      `clients/${id}/portrait-uploaded-1764250000000.j/pg`,
      `clients/${id}/sources/b/0-a.pdf`,
      `x/clients/${id}/portrait-uploaded-1764250000000.jpg`,
    ])
      expect(isUploadedPortraitPath(id, path)).toBe(false);
  });
});
