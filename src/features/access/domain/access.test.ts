import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  formatGuestCode,
  guestCodeFrom,
  normalizeGuestCode,
} from "./guest-code";
import {
  guestPassStatus,
  hostEmails,
  LIMITS,
  parseDisplayName,
  parseGuestPassRequest,
  passwordProblem,
  safeNextPath,
} from "./guest-pass";

describe("Guest code", () => {
  it("has 32 distinct symbols and none that look alike", () => {
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/);
  });

  it("is made of the alphabet, in groups of four", () => {
    const bytes = Uint8Array.from({ length: CODE_LENGTH }, (_, i) => i * 21);
    const code = guestCodeFrom(bytes);
    expect(code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(normalizeGuestCode(code)).toBe(code.replaceAll("-", ""));
  });

  it("refuses too few random bytes", () => {
    expect(() => guestCodeFrom(new Uint8Array(4))).toThrow();
  });

  it("reads a code however it was typed", () => {
    expect(normalizeGuestCode(" abcd efgh-jkmn ")).toBe("ABCDEFGHJKMN");
    expect(formatGuestCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
  });

  it("rejects what cannot be a code", () => {
    expect(normalizeGuestCode("")).toBeNull();
    expect(normalizeGuestCode("ABCD-EFGH")).toBeNull();
    expect(normalizeGuestCode("ABCD-EFGH-JKM0")).toBeNull();
    expect(normalizeGuestCode("ABCD-EFGH-JKMN-PQRS")).toBeNull();
  });
});

describe("Guest pass", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");

  it("is live until it expires or is revoked", () => {
    const expiresAt = "2026-11-10T13:00:00Z";
    expect(guestPassStatus({ expiresAt, revokedAt: null }, now)).toBe("live");
    expect(
      guestPassStatus(
        { expiresAt: "2026-11-10T12:00:00Z", revokedAt: null },
        now,
      ),
    ).toBe("expired");
    expect(
      guestPassStatus({ expiresAt, revokedAt: "2026-11-10T11:00:00Z" }, now),
    ).toBe("revoked");
  });

  it("accepts only requests inside the limits", () => {
    expect(
      parseGuestPassRequest({
        label: "  Ana   Cruz ",
        hours: "24",
        devices: "2",
      }),
    ).toEqual({ label: "Ana Cruz", hours: 24, devices: 2 });
    expect(
      parseGuestPassRequest({ label: "", hours: 24, devices: 1 }),
    ).toBeNull();
    expect(
      parseGuestPassRequest({ label: "Ana", hours: 9999, devices: 1 }),
    ).toBeNull();
    expect(
      parseGuestPassRequest({
        label: "Ana",
        hours: 24,
        devices: LIMITS.maxDevices + 1,
      }),
    ).toBeNull();
    expect(
      parseGuestPassRequest({ label: "Ana", hours: 24, devices: 0 }),
    ).toBeNull();
  });
});

describe("Profile", () => {
  it("tidies a display name and refuses one that is too long", () => {
    expect(parseDisplayName("  Reljod   Oreta ")).toBe("Reljod Oreta");
    expect(parseDisplayName("")).toBe("");
    expect(parseDisplayName("x".repeat(LIMITS.nameLength + 1))).toBeNull();
  });

  it("checks a new password", () => {
    const ok = {
      current: "old-password",
      next: "new-password",
      confirm: "new-password",
    };
    expect(passwordProblem(ok)).toBeNull();
    expect(passwordProblem({ ...ok, next: "short", confirm: "short" })).toMatch(
      /at least/,
    );
    expect(passwordProblem({ ...ok, confirm: "other-password" })).toMatch(
      /differ/,
    );
    expect(
      passwordProblem({ ...ok, next: "old-password", confirm: "old-password" }),
    ).toMatch(/same/);
    const long = "x".repeat(LIMITS.passwordMaxLength + 1);
    expect(passwordProblem({ ...ok, next: long, confirm: long })).toMatch(
      /at most/,
    );
  });
});

describe("safeNextPath", () => {
  it("keeps a demo on this site", () => {
    expect(safeNextPath("/demos/casework")).toBe("/demos/casework");
    expect(safeNextPath("/ask/abc?ask=hi")).toBe("/ask/abc?ask=hi");
  });

  it("falls back for anything else", () => {
    for (const next of [
      undefined,
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/about",
      "/demosevil",
      "/access/guests",
      "demos/casework",
    ]) {
      expect(safeNextPath(next)).toBe("/#demos");
    }
  });
});

describe("hostEmails", () => {
  it("reads a comma-separated list, and nobody from an empty one", () => {
    expect(hostEmails(" A@x.io, b@x.io ,")).toEqual(["a@x.io", "b@x.io"]);
    expect(hostEmails("")).toEqual([]);
  });
});
