import { describe, expect, it } from "vitest";
import { beatsForStep, closingBeats, openingBeats } from "./choreography";
import { chooseGait, gripFor, haulGait } from "./gait";

describe("chooseGait", () => {
  it("gallops side-on under 25° and faces the way he runs", () => {
    expect(chooseGait(300, 50)).toMatchObject({
      pose: "run",
      flip: false,
      rot: 0,
    });
    expect(chooseGait(-300, 50)).toMatchObject({ pose: "run", flip: true });
  });

  it("runs in top view going down and bottom view going up past 60°", () => {
    expect(chooseGait(40, 300).pose).toBe("run-down");
    expect(chooseGait(40, -300).pose).toBe("run-up");
  });

  it("flies the diagonals, tilted to the path", () => {
    const gait = chooseGait(200, 200);
    expect(gait.pose).toBe("fly");
    expect(gait.rot).toBe(53);
    expect(chooseGait(-200, -200)).toMatchObject({
      pose: "fly",
      flip: true,
      rot: -37,
    });
  });

  it("goes faster at a dash and never snaps there instantly", () => {
    expect(chooseGait(800, 0, "dash").duration).toBeLessThan(
      chooseGait(800, 0, "stroll").duration,
    );
    expect(chooseGait(2, 0).duration).toBeGreaterThan(0.4);
  });
});

describe("hauling", () => {
  it("carries small pieces and drags big ones", () => {
    expect(gripFor("figure")).toBe("carry");
    expect(gripFor("quote")).toBe("carry");
    expect(gripFor("job")).toBe("drag");
    expect(gripFor("card")).toBe("drag");
  });

  it("walks backwards when dragging, so he faces the block", () => {
    expect(haulGait(300, 0, "drag").flip).toBe(true);
    expect(haulGait(300, 0, "carry").flip).toBe(false);
    expect(haulGait(600, 0, "drag").duration).toBeGreaterThan(
      haulGait(600, 0, "carry").duration,
    );
  });
});

describe("choreography", () => {
  const step = {
    action: "fetch" as const,
    source: "experience.3",
    excerpt: null,
    pace: "trot" as const,
    line: "This one!",
  };

  it("fetches: run, rip, haul, stamp", () => {
    expect(beatsForStep(step, "job").map((beat) => beat.type)).toEqual([
      "run-to",
      "rip",
      "haul",
      "stamp",
    ]);
  });

  it("tosses: run, rip, toss, and never reaches the board", () => {
    expect(
      beatsForStep({ ...step, action: "toss" }, "job").map((beat) => beat.type),
    ).toEqual(["run-to", "rip", "toss"]);
  });

  it("unstitches first, rewinds on follow-ups, and Reforms only with blocks placed", () => {
    expect(openingBeats(false)).toEqual([{ type: "unstitch" }]);
    expect(openingBeats(true)).toEqual([{ type: "rewind" }]);
    expect(closingBeats(0)).toEqual([]);
    expect(closingBeats(2)).toEqual([{ type: "reform" }]);
  });
});
