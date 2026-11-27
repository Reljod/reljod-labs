import { describe, expect, it } from "vitest";
import { redoProblem, workProblem } from "./caps";
import { LIMITS } from "./limits";

const clear = {
  visitorStartsLastHour: 0,
  startsToday: 0,
  ownerSpentToday: 0,
  activeRunId: null,
};

describe("workProblem", () => {
  it("lets work start under every cap", () => {
    expect(workProblem(clear, { trusted: false })).toBeNull();
  });

  it("refuses a second active Run, even for the e2e suite", () => {
    expect(
      workProblem({ ...clear, activeRunId: "r" }, { trusted: true }),
    ).toMatch(/still going/);
  });

  it("applies the spend, hourly and daily caps at their limits", () => {
    expect(
      workProblem(
        { ...clear, ownerSpentToday: LIMITS.spendPerOwnerPerDay },
        { trusted: false },
      ),
    ).toMatch(/daily cap/);
    expect(
      workProblem(
        { ...clear, ownerSpentToday: LIMITS.spendPerOwnerPerDay - 0.01 },
        { trusted: false },
      ),
    ).toBeNull();
    expect(
      workProblem(
        { ...clear, visitorStartsLastHour: LIMITS.runsPerVisitorPerHour },
        { trusted: false },
      ),
    ).toMatch(/this hour/);
    expect(
      workProblem(
        { ...clear, startsToday: LIMITS.runsPerDay },
        { trusted: false },
      ),
    ).toMatch(/today's limit/);
  });

  it("lets the e2e suite past the rate and spend caps", () => {
    expect(
      workProblem(
        {
          ...clear,
          ownerSpentToday: 99,
          visitorStartsLastHour: 99,
          startsToday: 9999,
        },
        { trusted: true },
      ),
    ).toBeNull();
  });
});

describe("redoProblem", () => {
  const done = {
    status: "completed",
    hasProcess: true,
    verified: true,
    redos: 0,
  };
  it("allows a finished Run with a Process, up to the cap", () => {
    expect(redoProblem(done)).toBeNull();
    expect(redoProblem({ ...done, redos: LIMITS.redosPerRun - 1 })).toBeNull();
    expect(redoProblem({ ...done, redos: LIMITS.redosPerRun })).toMatch(
      /redone 3 times/,
    );
  });
  it("refuses a Run whose Process was never verified", () => {
    expect(redoProblem({ ...done, status: "stopped", verified: false })).toBe(
      "This Run stopped before its Process was verified; start a new Run.",
    );
    expect(redoProblem({ ...done, status: "failed", verified: false })).toMatch(
      /before its Process was verified/,
    );
  });

  it("refuses a running Run or one without a Process", () => {
    expect(redoProblem({ ...done, status: "running" })).toMatch(/still going/);
    expect(redoProblem({ ...done, hasProcess: false })).toMatch(/no Process/);
  });
});
