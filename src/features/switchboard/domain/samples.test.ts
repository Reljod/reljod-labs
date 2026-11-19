import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SAMPLE_CALLERS, sampleCaller, sampleClipPath } from "./samples";
import { normalizeReference, SEED_BOOKINGS } from "./world";

const publicDir = fileURLToPath(new URL("../../../../public", import.meta.url));

describe("SAMPLE_CALLERS", () => {
  it("has unique ids that are safe in a path", () => {
    const ids = SAMPLE_CALLERS.map((caller) => caller.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("talks about a Booking the Back office has", () => {
    const refs = new Set(SEED_BOOKINGS.map((booking) => booking.reference));
    for (const caller of SAMPLE_CALLERS) {
      if (caller.bookingRef === null) continue;
      expect(refs.has(caller.bookingRef), caller.id).toBe(true);
      expect(normalizeReference(caller.bookingRef)).toBe(caller.bookingRef);
    }
  });

  it("has lines with text, and spells out for the voice every line with digits", () => {
    for (const caller of SAMPLE_CALLERS) {
      expect(caller.lines.length, caller.id).toBeGreaterThan(0);
      caller.lines.forEach((line, index) => {
        const where = `${caller.id} line ${index + 1}`;
        expect(line.text.trim(), where).not.toBe("");
        if (/\d|MR-/.test(line.text)) {
          expect(line.say?.trim(), where).toBeTruthy();
          expect(line.say, where).not.toMatch(/\d/);
        }
        if (line.bargeAfterMs !== undefined)
          expect(line.bargeAfterMs, where).toBeGreaterThan(0);
      });
    }
  });

  it("names the Booking's reference in a line when it has one", () => {
    for (const caller of SAMPLE_CALLERS) {
      if (!caller.bookingRef) continue;
      expect(
        caller.lines.some((line) =>
          line.text.includes(caller.bookingRef as string),
        ),
        caller.id,
      ).toBe(true);
    }
  });
});

describe("sampleCaller", () => {
  it("finds a caller by id", () => {
    expect(sampleCaller("commuter")?.name).toBe("Lena");
    expect(sampleCaller("nobody")).toBeUndefined();
  });
});

describe("sampleClipPath", () => {
  it("numbers clips from 1", () => {
    expect(sampleClipPath("angry", 0)).toBe("/switchboard/samples/angry/1.mp3");
    expect(sampleClipPath("angry", 4)).toBe("/switchboard/samples/angry/5.mp3");
  });

  it("points at a clip that exists for every line", () => {
    for (const caller of SAMPLE_CALLERS) {
      caller.lines.forEach((_line, index) => {
        const file = `${publicDir}${sampleClipPath(caller.id, index)}`;
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size, file).toBeGreaterThan(0);
      });
    }
  });
});
