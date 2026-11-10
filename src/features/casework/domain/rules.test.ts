import { describe, expect, it } from "vitest";
import { emptyRun, reduceRun } from "../components/run-reducer";
import { isoDate } from "./dates";
import { planJobs } from "./jobs";
import { nameScore, sameName, surnameChanged } from "./names";
import { inferPipeline, PIPELINES } from "./pipelines";
import { reconcile } from "./rules/contributions";
import { recommend } from "./rules/decision";
import type { RunState } from "./run-state";

const state = (patch: Partial<RunState>): RunState => ({
  runId: "test",
  asOf: "2026-11-10",
  documents: [],
  checks: [],
  gaps: [],
  answers: [],
  ...patch,
});

describe("names", () => {
  it("ignores order, accents and case", () => {
    expect(sameName("Liang Zhi Wei", "Zhiwei Liang")).toBe(true);
    expect(
      sameName("José Luis HERRERA CASTILLO", "Jose Luis Herrera Castillo"),
    ).toBe(true);
  });
  it("keeps different people apart", () => {
    expect(nameScore("Tamara Rivers", "Tamara Bodden")).toBeLessThan(88);
  });
  it("spots a married name", () => {
    expect(surnameChanged("Lorna Dacosta", "Lorna Merren")).toBe(true);
    expect(surnameChanged("Lorna Dacosta", "Peter Dacosta")).toBe(false);
  });
});

describe("dates", () => {
  it("rejects impossible dates", () => {
    expect(isoDate("1990-04-31")).toBeNull();
    expect(isoDate("14 FEB 2023")).toBe("2023-02-14");
  });
});

describe("planning", () => {
  it("runs what a job depends on first", () => {
    expect(planJobs(["screen"])).toEqual(["sort", "read", "screen"]);
    expect(planJobs(["decide"])).toEqual(["decide"]);
  });
  it("starts every pipeline with sort, which pipeline inference relies on", () => {
    for (const pipeline of Object.values(PIPELINES))
      expect(pipeline.jobs[0]).toBe("sort");
  });
  it("infers the pipeline from sorted kinds, and declines to guess on a tie", () => {
    expect(
      inferPipeline(["withdrawal_request_form", "identity_document"]),
    ).toBe("pension_withdrawal");
    expect(inferPipeline(["screening_alert", "customer_profile"])).toBe(
      "screening_review",
    );
    expect(inferPipeline(["identity_document"])).toBeNull();
  });
});

describe("reconcile", () => {
  it("finds short payments, late months and arrears", () => {
    const lines = [
      // On time and in full: 5% + 5% of 3,000.
      {
        period: "2026-07",
        employee_id: "A",
        full_name: "A",
        gross_earnings: 3000,
        employee_contribution: 150,
        employer_contribution: 150,
        date_paid: "2026-08-14",
      },
      // Paid late, and the employer paid 4%.
      {
        period: "2026-08",
        employee_id: "A",
        full_name: "A",
        gross_earnings: 3000,
        employee_contribution: 150,
        employer_contribution: 120,
        date_paid: "2026-09-20",
      },
      // Above the cap: only M$7,250 is pensionable.
      {
        period: "2026-08",
        employee_id: "B",
        full_name: "B",
        gross_earnings: 9000,
        employee_contribution: 362.5,
        employer_contribution: 362.5,
        date_paid: "2026-09-20",
      },
    ];
    const outcome = reconcile(
      state({
        documents: [
          {
            id: "s",
            name: "s.csv",
            mediaType: "text/csv",
            sourceFormat: "csv",
            pageCount: 1,
            kind: "contribution_schedule",
            fields: { employer_name: "", lines },
          },
        ],
      }),
    );
    expect(outcome.patch?.arrears?.total).toBe(30);
    expect(
      outcome.checks.find((check) => check.id === "contributions_on_time")
        ?.outcome,
    ).toBe("fail");
    expect(
      outcome.checks.find((check) => check.id === "contributions_at_rate")
        ?.outcome,
    ).toBe("fail");
  });
});

describe("recommend", () => {
  it("puts a blocking fail before missing documents, and missing documents before a refer", () => {
    const fail = { job: "screen" as const, detail: "", evidence: [] };
    expect(
      recommend(
        state({
          checks: [{ ...fail, id: "screening_clear", outcome: "fail" }],
          gaps: [{ job: "read", wants: "x" }],
        }),
      ),
    ).toBe("decline");
    expect(
      recommend(
        state({
          checks: [{ ...fail, id: "id_certified", outcome: "review" }],
          gaps: [{ job: "read", wants: "x" }],
        }),
      ),
    ).toBe("request_info");
    expect(
      recommend(
        state({ checks: [{ ...fail, id: "id_certified", outcome: "review" }] }),
      ),
    ).toBe("refer");
    expect(
      recommend(
        state({ checks: [{ ...fail, id: "id_certified", outcome: "pass" }] }),
      ),
    ).toBe("approve");
  });
});

describe("the run view", () => {
  it("folds a stream into jobs, a question and its answer", () => {
    const events = [
      {
        at: 1,
        type: "plan",
        pipeline: "pension_withdrawal",
        jobs: ["sort", "read"],
        inferred: true,
      },
      { at: 2, type: "job", index: 0, job: "sort", state: "start" },
      {
        at: 3,
        type: "question",
        questionId: "q",
        job: "sort",
        prompt: "Need an ID",
        kinds: ["identity_document"],
        options: [],
      },
      { at: 4, type: "answer", questionId: "q", summary: "Go on without it" },
      { at: 5, type: "job", index: 0, job: "sort", state: "done" },
      { at: 6, type: "end", status: "completed" },
    ] as const;
    const view = events.reduce(
      (current, event) => reduceRun(current, event as never),
      emptyRun,
    );
    expect(view.inferred).toBe(true);
    expect(view.question).toBeNull();
    expect(view.answered).toHaveLength(1);
    expect(view.jobs.map((job) => job.state)).toEqual(["done", "pending"]);
    expect(view.status).toBe("completed");
  });
});
