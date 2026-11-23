import { describe, expect, it } from "vitest";
import { cleanReading } from "./brief";
import { roomReporter } from "./reporter";
import { scenarioById } from "./scenarios";

const halyard = scenarioById("halyard-air");
if (!halyard) throw new Error("missing scenario");
const candidates = halyard.injects.filter((inject) => inject.slot === 1);

describe("roomReporter", () => {
  it("reports each part once, only when it is complete", () => {
    const report = roomReporter(candidates);
    expect(
      report({ voices: [{ who: "press", line: "Half a li" }] }, false),
    ).toEqual([]);
    const second = report(
      {
        voices: [
          { who: "press", line: "Half a line, now whole.", mood: -1 },
          { who: "staff", line: "Still go" },
        ],
      },
      false,
    );
    expect(second).toEqual([
      {
        t: "voice",
        voice: { who: "press", line: "Half a line, now whole.", mood: -1 },
      },
    ]);
    const end = report(
      {
        voices: [
          { who: "press", line: "Half a line, now whole.", mood: -1 },
          { who: "staff", line: "Still going, and done.", mood: 9 },
        ],
        headline: { outlet: "Courier", text: "Halyard says it" },
        posts: [{ handle: "@@a", text: "post" }],
        whisper: "  Watch  the Chair. ",
        next: "not-a-real-inject",
      },
      true,
    );
    expect(end).toEqual([
      {
        t: "voice",
        voice: { who: "staff", line: "Still going, and done.", mood: 2 },
      },
      {
        t: "headline",
        headline: { outlet: "Courier", text: "Halyard says it" },
      },
      { t: "post", post: { handle: "a", text: "post" } },
      { t: "whisper", text: "Watch the Chair." },
      // The model's pick is not one the Engine allows, so the first allowed lands.
      { t: "next", inject: candidates[0]?.id },
    ]);
  });

  it("drops a voice for someone who is not at the table", () => {
    const report = roomReporter([]);
    expect(
      report({ voices: [{ who: "ceo", line: "I decide." }] }, true),
    ).toEqual([{ t: "next", inject: null }]);
  });
});

describe("cleanReading", () => {
  it("keeps only real Levers, at most three, once each", () => {
    expect(
      cleanReading(halyard, {
        heard: "You pay.",
        levers: [
          "pay_ransom",
          "pay_ransom",
          "launch_rockets",
          "hotels",
          "refunds",
          "statement",
        ],
        outside: "",
      }),
    ).toEqual({
      heard: "You pay.",
      levers: ["pay_ransom", "hotels", "refunds"],
      outside: null,
    });
  });
});
