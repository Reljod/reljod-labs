import { describe, expect, it } from "vitest";
import { beatsForStep, closingBeats, openingBeats } from "./choreography";
import { chooseGait } from "./gait";

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

describe("pushing", () => {
  it("uses the same gaits with a block ahead, only slower", () => {
    expect(chooseGait(0, -600, "trot", true).pose).toBe("run-up");
    expect(chooseGait(600, 0, "trot", true).duration).toBeGreaterThan(
      chooseGait(600, 0).duration,
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

  it("fetches: run, rip, push, stack", () => {
    expect(beatsForStep(step).map((beat) => beat.type)).toEqual([
      "run-to",
      "rip",
      "push",
      "stack",
    ]);
  });

  it("tosses: run, rip, toss, and never reaches the Stack", () => {
    expect(
      beatsForStep({ ...step, action: "toss" }).map((beat) => beat.type),
    ).toEqual(["run-to", "rip", "toss"]);
  });

  it("unstitches first, rewinds on follow-ups, and kicks and writes only with blocks stacked", () => {
    expect(openingBeats(false)).toEqual([{ type: "unstitch" }]);
    expect(openingBeats(true)).toEqual([{ type: "rewind" }]);
    expect(closingBeats(0)).toEqual([]);
    expect(closingBeats(2).map((beat) => beat.type)).toEqual(["kick", "write"]);
  });
});
