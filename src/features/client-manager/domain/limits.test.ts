import { describe, expect, it } from "vitest";
import { LIMITS, refusalFor, type Usage24h } from "./limits";

const none: Usage24h = {
  hourBuilds: 0,
  hourAsks: 0,
  hourResearch: 0,
  visitorCost: 0,
  ownerCost: 0,
  allBuilds: 0,
  allAsks: 0,
};

describe("refusalFor", () => {
  it("lets an ask and a build through with room under every cap", () => {
    expect(refusalFor("ask", none)).toBeNull();
    expect(refusalFor("research", none)).toBeNull();
    expect(refusalFor("build", none)).toBeNull();
  });

  it("refuses once the Owner's daily spend is used, from any IP", () => {
    const usage = { ...none, ownerCost: LIMITS.spendPerOwnerPerDay };
    expect(refusalFor("ask", usage)).toMatch(/budget/);
    expect(refusalFor("build", usage)).toMatch(/budget/);
  });

  it("refuses once the visitor's daily spend is used", () => {
    expect(
      refusalFor("ask", { ...none, visitorCost: LIMITS.spendPerVisitorPerDay }),
    ).toMatch(/budget/);
  });

  it("refuses an ask once everyone's questions today reach the global cap", () => {
    const usage = { ...none, allAsks: LIMITS.asksPerDay };
    expect(refusalFor("ask", usage)).toMatch(/today's limit of questions/);
    expect(refusalFor("research", usage)).toMatch(/today's limit/);
    expect(refusalFor("build", usage)).toBeNull();
  });

  it("refuses per-hour asks, research and builds", () => {
    expect(
      refusalFor("ask", { ...none, hourAsks: LIMITS.asksPerHour }),
    ).toMatch(/questions this hour/);
    const research = { ...none, hourResearch: LIMITS.researchPerHour };
    expect(refusalFor("research", research)).toMatch(/research runs/);
    expect(refusalFor("ask", research)).toBeNull();
    expect(
      refusalFor("build", { ...none, hourBuilds: LIMITS.buildsPerHour }),
    ).toMatch(/graph builds this hour/);
    expect(
      refusalFor("build", { ...none, allBuilds: LIMITS.buildsPerDay }),
    ).toMatch(/today's limit of graph builds/);
  });
});
