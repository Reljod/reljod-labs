import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  disposeOptions,
  IMAGE_KEEP_DAYS,
  imageBuildOptions,
  imageIsFresh,
  imageSnapshotOptions,
  ownerSandboxOptions,
  ownerSandboxUpdate,
  SANDBOX_REGION,
} from "./options";

const DAY = 24 * 60 * 60_000;

describe("Canvas Sandboxes leave no snapshots behind", () => {
  it("an Owner's Sandbox is created not persistent, in the image's region, with no network", () => {
    const options = ownerSandboxOptions("canvas-abc", "snap_1");
    expect(options.persistent).toBe(false);
    expect(options.region).toBe(imageBuildOptions().region);
    expect(options.region).toBe(SANDBOX_REGION);
    expect(options.networkPolicy).toBe("deny-all");
    expect(options.source).toEqual({ type: "snapshot", snapshotId: "snap_1" });
    expect("snapshotExpiration" in options).toBe(false);
  });

  it("an existing Sandbox is switched to not persistent and the image's region after getOrCreate", () => {
    expect(ownerSandboxUpdate()).toEqual({
      persistent: false,
      networkPolicy: "deny-all",
      region: SANDBOX_REGION,
    });
  });

  it("the image is built in a Sandbox that is not persistent", () => {
    expect(imageBuildOptions().persistent).toBe(false);
  });

  it("the image snapshot expires: bounded, a few days, never 0", () => {
    const { expiration } = imageSnapshotOptions();
    expect(expiration).toBeGreaterThan(0);
    expect(expiration).toBeLessThanOrEqual(7 * DAY);
    expect(expiration).toBe(IMAGE_KEEP_DAYS * DAY);
  });

  it("deleting a Sandbox deletes the snapshots it left", () => {
    expect(disposeOptions()).toEqual({ deleteOrphanSnapshots: true });
  });

  it("an image is rebuilt before its snapshot expires, and one never built is not fresh", () => {
    const now = Date.parse("2026-11-20T00:00:00Z");
    expect(imageIsFresh(null, now)).toBe(false);
    expect(imageIsFresh(new Date(now - DAY), now)).toBe(true);
    expect(imageIsFresh(new Date(now - IMAGE_KEEP_DAYS * DAY), now)).toBe(
      false,
    );
    // Inside the margin before expiry it already counts as gone.
    expect(
      imageIsFresh(new Date(now - IMAGE_KEEP_DAYS * DAY + 60 * 60_000), now),
    ).toBe(false);
  });

  it("no Sandbox call in Canvas bypasses these options", () => {
    const read = (file: string) =>
      readFileSync(join(import.meta.dirname, file), "utf8");
    const session = read("session.ts");
    const image = read("image.ts");
    // Every create goes through an options function from this module.
    expect(session).toMatch(
      /Sandbox\.getOrCreate\(\{\s*\.\.\.ownerSandboxOptions\(/,
    );
    expect(session).toMatch(/\.update\(\s*ownerSandboxUpdate\(\)/);
    expect(image).toMatch(/Sandbox\.create\(\s*imageBuildOptions\(\)/);
    expect(image).toMatch(/\.snapshot\(imageSnapshotOptions\(\)\)/);
    // Every delete of a Sandbox takes its snapshots.
    for (const source of [session, image]) {
      const deletes =
        source.match(/sandbox\.delete\((?:[^()]|\([^)]*\))*\)/g) ?? [];
      for (const call of deletes)
        expect(call).toBe("sandbox.delete(disposeOptions())");
      expect(source).not.toMatch(/persistent:\s*true/);
      expect(source).not.toMatch(/expiration:\s*0\b/);
      expect(source).not.toMatch(/snapshotExpiration/);
    }
    expect(session).toContain("sandbox.delete(disposeOptions())");
  });
});
