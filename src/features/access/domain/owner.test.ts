import { describe, expect, it } from "vitest";
import {
  extendedExpiry,
  guestPassStatus,
  LIMITS,
  parseDuration,
  purgeDate,
} from "./guest-pass";
import { guestPassIdOf, ownerOf, parseOwner } from "./owner";

const PASS = "6f1c3c2e-6d55-4b8e-9a51-2f7c1d0a9b10";
const USER = "0b8d7a44-1f2e-4c3d-8e9f-a0b1c2d3e4f5";

describe("ownerOf", () => {
  it("gives a Guest's data to their pass, not their device", () => {
    expect(ownerOf({ kind: "guest", passId: PASS })).toBe(`guest:${PASS}`);
  });

  it("gives a Host their own data, and the e2e suite its own", () => {
    expect(ownerOf({ kind: "host", userId: USER })).toBe(`host:${USER}`);
    expect(ownerOf({ kind: "e2e" })).toBe("e2e");
  });
});

describe("parseOwner", () => {
  it("reads back what ownerOf writes", () => {
    for (const owner of [`guest:${PASS}`, `host:${USER}`, "e2e"]) {
      expect(parseOwner(owner)).toBe(owner);
    }
  });

  it("refuses anything else, such as a bare browser session id", () => {
    for (const value of [
      PASS,
      "guest:",
      "guest:not-a-uuid",
      `admin:${PASS}`,
      `guest:${PASS}:extra`,
      null,
      42,
    ]) {
      expect(parseOwner(value)).toBeNull();
    }
  });

  it("names the Guest pass of a Guest Owner only", () => {
    expect(guestPassIdOf(`guest:${PASS}`)).toBe(PASS);
    expect(guestPassIdOf(`host:${USER}`)).toBeNull();
    expect(guestPassIdOf("e2e")).toBeNull();
  });
});

describe("Guest pass retention", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const hour = 3_600_000;

  it("counts a deleted pass as deleted whatever else it is", () => {
    expect(
      guestPassStatus(
        {
          expiresAt: new Date(now + hour).toISOString(),
          revokedAt: null,
          deletedAt: new Date(now).toISOString(),
        },
        now,
      ),
    ).toBe("deleted");
  });

  it("purges 30 days after the delete", () => {
    const deletedAt = "2026-11-15T12:00:00.000Z";
    expect(purgeDate(deletedAt).toISOString()).toBe("2026-12-15T12:00:00.000Z");
    expect(LIMITS.retentionDays).toBe(30);
  });

  it("adds to what is left of a live pass", () => {
    const expiresAt = new Date(now + 2 * hour).toISOString();
    expect(extendedExpiry({ expiresAt }, 24, now).getTime()).toBe(
      now + 26 * hour,
    );
  });

  it("counts a renewal from now for a pass that ended", () => {
    const expiresAt = new Date(now - 48 * hour).toISOString();
    expect(extendedExpiry({ expiresAt }, 4, now).getTime()).toBe(
      now + 4 * hour,
    );
  });

  it("never runs more than the longest duration from now", () => {
    const expiresAt = new Date(now + 100 * hour).toISOString();
    expect(extendedExpiry({ expiresAt }, 168, now).getTime()).toBe(
      now + 168 * hour,
    );
  });

  it("accepts only the durations on offer", () => {
    expect(parseDuration("24")).toBe(24);
    expect(parseDuration("5")).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });
});
