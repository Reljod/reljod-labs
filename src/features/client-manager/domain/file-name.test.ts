import { describe, expect, it } from "vitest";
import { safeExtension } from "./file-name";

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
