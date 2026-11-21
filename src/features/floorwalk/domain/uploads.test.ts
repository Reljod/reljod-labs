import { describe, expect, it } from "vitest";
import { sourceSchema } from "./api";
import { expiredHours, ownerSlug, ownsUpload, uploadHour } from "./uploads";

const NOW = new Date("2026-11-21T15:20:00Z");

describe("uploads", () => {
  it("files an upload under its UTC hour and its Owner", () => {
    expect(uploadHour(NOW)).toBe("2026112115");
    expect(ownerSlug("guest:5f0c-AB")).toBe("guest-5f0c-ab");
  });

  it("sweeps only whole hours older than the retention, and nothing that is not an hour", () => {
    expect(
      expiredHours(
        [
          "2026112115",
          "2026112109",
          "2026112108",
          "2026112023",
          "notes",
          "20261121",
        ],
        NOW,
      ),
    ).toEqual(["2026112023", "2026112108"]);
  });

  it("lets an Owner reach only their own folder", () => {
    const path =
      "uploads/2026112115/guest-abc/00000000-0000-4000-8000-000000000000.mp4";
    expect(ownsUpload(path, "guest:abc")).toBe(true);
    expect(ownsUpload(path, "guest:abd")).toBe(false);
    expect(ownsUpload("uploads/guest-abc/x.mp4", "guest:abc")).toBe(false);
  });

  it("refuses a path that leaves the uploads folder before it reaches the server", () => {
    for (const path of [
      "uploads/2026112115/guest-abc/../e2e/00000000-0000-4000-8000-000000000000.mp4",
      "uploads/2026112115/guest-abc/00000000-0000-4000-8000-000000000000.mp4.exe",
      "samples/cold-store.mp4",
    ])
      expect(
        sourceSchema.safeParse({ kind: "upload", path }).success,
        path,
      ).toBe(false);
  });
});
