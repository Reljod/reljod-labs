import { describe, expect, it } from "vitest";
import { beatsForStep, closingBeats, openingBeats } from "./choreography";
import { chooseGait, gripFor, haulGait, holdOffset } from "./gait";

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
  it("carries small pieces and pushes big ones", () => {
    expect(gripFor("figure")).toBe("carry");
    expect(gripFor("quote")).toBe("carry");
    expect(gripFor("job")).toBe("push");
    expect(gripFor("card")).toBe("push");
  });

  it("faces where he goes, and pushing is slower than carrying", () => {
    expect(haulGait(300, 0, "push").flip).toBe(false);
    expect(haulGait(-300, 0, "carry").flip).toBe(true);
    expect(haulGait(600, 0, "push").duration).toBeGreaterThan(
      haulGait(600, 0, "carry").duration,
    );
  });

  it("holds the block on his raised paws or against the paws he faces with", () => {
    const cat = { w: 120, h: 125 };
    const block = { w: 360, h: 100 };
    const overhead = holdOffset("carry", false, cat, block);
    expect(overhead.x + block.w / 2).toBe(cat.w / 2);
    expect(overhead.y + block.h).toBeLessThan(cat.h * 0.4);
    expect(holdOffset("push", false, cat, block).x).toBeGreaterThan(
      cat.w * 0.8,
    );
    const left = holdOffset("push", true, cat, block);
    expect(left.x + block.w).toBeLessThan(cat.w * 0.2);
  });

  it("never takes so long that he crawls", () => {
    expect(chooseGait(5000, 0, "stroll").duration).toBeLessThanOrEqual(2.8);
  });
});

describe("choreography", () => {
  const step = {
    action: "fetch" as const,
    source: "experience.3",
    excerpt: null,
    join: "He worked as",
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
