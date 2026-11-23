import { describe, expect, it } from "vitest";
import { play, type Round } from "./engine";
import { scorecard } from "./review";
import { checkRules } from "./rules";
import { scenarioById } from "./scenarios";

const halyard = scenarioById("halyard-air");
if (!halyard) throw new Error("missing scenario");

const option = (inject: string, id: string): Round => ({
  inject,
  choice: { kind: "option", option: id },
  levers: [],
});

const status = (rounds: Round[]) =>
  Object.fromEntries(
    checkRules(halyard, play(halyard, rounds)).map((f) => [f.rule, f.status]),
  );

describe("checkRules", () => {
  it("keeps a deadline open until the clock passes it", () => {
    expect(
      status([option("screens-black", "screens-black/roster")]),
    ).toMatchObject({
      "inform-6h": "open",
      "report-24h": "open",
      "ransom-told": "open",
      "no-mislead": "open",
    });
  });

  it("meets a deadline on time and misses it once the clock passes", () => {
    const told = status([
      option("screens-black", "screens-black/roster"),
      option("courier-memo", "courier-memo/confirm"),
    ]);
    expect(told["inform-6h"]).toBe("met");
    const silent = status([
      option("screens-black", "screens-black/roster"),
      option("courier-memo", "courier-memo/vendor"),
      option("duty-hours", "duty-hours/hall"),
    ]);
    expect(silent["inform-6h"]).toBe("missed");
  });

  it("calls a late step missed, with the hours it was late", () => {
    const findings = checkRules(
      halyard,
      play(halyard, [
        option("screens-black", "screens-black/roster"),
        option("courier-memo", "courier-memo/vendor"),
        option("duty-hours", "duty-hours/hall"),
        option("authority-letter", "authority-letter/board"),
        option("decryptor-offer", "decryptor-offer/care"),
        option("back-in-the-air", "back-in-the-air/camera"),
      ]),
    );
    const inform = findings.find((f) => f.rule === "inform-6h");
    expect(inform).toMatchObject({ status: "missed", at: 60 });
    expect(inform?.note).toContain("54h after");
    expect(findings.find((f) => f.rule === "report-24h")?.status).toBe(
      "missed",
    );
  });

  it("breaks a 'before' Rule when the step comes first", () => {
    const findings = status([
      option("screens-black", "screens-black/roster"),
      option("courier-memo", "courier-memo/confirm"),
      option("duty-hours", "duty-hours/hall"),
      option("chair-asks", "chair-asks/pay"),
    ]);
    expect(findings["ransom-told"]).toBe("broken");
  });

  it("breaks a 'never' Rule the moment it is done", () => {
    expect(
      status([
        option("screens-black", "screens-black/roster"),
        option("courier-memo", "courier-memo/hold"),
      ])["no-mislead"],
    ).toBe("broken");
  });
});

describe("scorecard", () => {
  it("finds the peak and when the fire was contained", () => {
    const state = play(halyard, [
      option("screens-black", "screens-black/roster"),
      option("courier-memo", "courier-memo/confirm"),
      option("duty-hours", "duty-hours/hall"),
      option("authority-letter", "authority-letter/file"),
      option("decryptor-offer", "decryptor-offer/care"),
      option("back-in-the-air", "back-in-the-air/crews"),
    ]);
    const card = scorecard(halyard, state);
    expect(card.heatline).toHaveLength(7);
    expect(card.peak.heat).toBeGreaterThanOrEqual(card.heatline[0]?.heat ?? 0);
    expect(card.containedAt).not.toBeNull();
    expect(card.findings.every((f) => f.status !== "open")).toBe(true);
  });
});
