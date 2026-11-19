import { describe, expect, it } from "vitest";
import { experience } from "@/content/experience";
import { careerRuler, periodSpan } from "./career-span";

const NOW = new Date(2026, 10, 19); // Nov 2026

describe("periodSpan", () => {
  it("reads a closed period, counting its last month", () => {
    expect(periodSpan("Jun 2019 – Feb 2020", NOW)).toEqual({
      start: 2019 * 12 + 5,
      end: 2020 * 12 + 2,
    });
  });

  it("runs a current job up to this month", () => {
    expect(periodSpan("Jul 2026 – Present", NOW)).toEqual({
      start: 2026 * 12 + 6,
      end: 2026 * 12 + 11,
    });
  });

  it("refuses what it cannot read rather than guess", () => {
    expect(periodSpan("2019", NOW)).toBeNull();
    expect(periodSpan("Foo 2019 – Bar 2020", NOW)).toBeNull();
    expect(periodSpan("Mar 2022 – Apr 2021", NOW)).toBeNull();
  });

  it("reads every period on the About page", () => {
    for (const job of experience) {
      expect(periodSpan(job.period, NOW), job.period).not.toBeNull();
    }
  });
});

describe("careerRuler", () => {
  it("lays the jobs from the first month (0) to the last (1)", () => {
    const ruler = careerRuler(
      ["Jan 2020 – Dec 2020", "Jan 2021 – Dec 2021"],
      NOW,
    );
    expect(ruler.jobs).toEqual([
      { index: 0, left: 0, width: 0.5 },
      { index: 1, left: 0.5, width: 0.5 },
    ]);
    expect(ruler.years).toEqual([
      { year: 2020, at: 0 },
      { year: 2021, at: 0.5 },
      { year: 2022, at: 1 },
    ]);
  });

  it("leaves an unreadable period off the ruler and keeps the others' indexes", () => {
    const ruler = careerRuler(["someday", "Jan 2020 – Dec 2020"], NOW);
    expect(ruler.jobs).toEqual([{ index: 1, left: 0, width: 1 }]);
  });

  it("is empty when nothing reads", () => {
    expect(careerRuler(["someday"], NOW)).toEqual({ jobs: [], years: [] });
  });
});
