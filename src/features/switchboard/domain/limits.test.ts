import { describe, expect, it } from "vitest";
import { LIMITS, voiceRefusal } from "./limits";

describe("voiceRefusal", () => {
  it("lets a voice Call through with room under both daily caps", () => {
    expect(voiceRefusal({ ownerToday: 0, everyoneToday: 0 })).toBeNull();
    expect(
      voiceRefusal({
        ownerToday: LIMITS.voiceCallsPerOwnerPerDay - 1,
        everyoneToday: LIMITS.voiceCallsPerDay - 1,
      }),
    ).toBeNull();
  });

  it("refuses once the Owner has used today's voice Calls, from any IP", () => {
    expect(
      voiceRefusal({
        ownerToday: LIMITS.voiceCallsPerOwnerPerDay,
        everyoneToday: 0,
      }),
    ).toMatch(/voice Calls today/);
  });

  it("refuses everyone once the global daily cap is reached", () => {
    expect(
      voiceRefusal({ ownerToday: 0, everyoneToday: LIMITS.voiceCallsPerDay }),
    ).toMatch(/limit for everyone/);
  });
});
