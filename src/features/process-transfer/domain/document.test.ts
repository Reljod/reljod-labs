import { describe, expect, it } from "vitest";
import type { DocumentMeta, StepBlock } from "./document";
import { documentDate, documentSections } from "./document";
import type { Process } from "./process";
import { SAMPLE_PROCESS } from "./test-fixtures";

const meta: DocumentMeta = {
  recordingName: "month-end-handover.mp4",
  generatedAt: "2026-11-17T09:30:00.000Z",
  status: "draft",
  checksSummary: "8 of 9 Checks passed",
};

const edit = (patch: (copy: Process) => void): Process => {
  const copy = structuredClone(SAMPLE_PROCESS);
  patch(copy);
  return copy;
};

describe("documentSections", () => {
  it("lays out the full document in order, numbered 1 to 10", () => {
    const sections = documentSections(SAMPLE_PROCESS, meta);
    expect(sections.map((item) => [item.number, item.heading])).toEqual([
      [null, "Month-end contribution reconciliation"],
      [1, "Purpose and scope"],
      [2, "When it runs"],
      [3, "Roles and responsibilities"],
      [4, "Systems"],
      [5, "Before you start"],
      [6, "Procedure"],
      [7, "Exceptions"],
      [8, "Controls"],
      [9, "Glossary"],
      [10, "Open questions"],
      [null, "How this document was made"],
    ]);
  });

  it("puts the handover, date, recording and draft status on the cover", () => {
    const [cover] = documentSections(SAMPLE_PROCESS, meta);
    expect(cover.eyebrow).toBe("Workflow document");
    const table = cover.blocks.find((block) => block.kind === "keyValue");
    expect(table?.kind === "keyValue" && table.rows).toEqual([
      { key: "Handed over by", value: "Amara Okafor, Senior Pensions Officer" },
      { key: "Taken over by", value: "Daniel Reyes, Pensions Officer" },
      { key: "Date", value: "17 November 2026" },
      { key: "Source recording", value: "month-end-handover.mp4" },
      { key: "Version", value: "0.1" },
      { key: "Status", value: "Draft: verify before use" },
    ]);
    expect(cover.blocks.some((block) => block.kind === "callout")).toBe(true);
    const approved = documentSections(SAMPLE_PROCESS, {
      ...meta,
      status: "approved",
      version: "1.0",
    })[0];
    expect(approved.blocks.some((block) => block.kind === "callout")).toBe(
      false,
    );
  });

  it("writes every step as a block with its time", () => {
    const procedure = documentSections(SAMPLE_PROCESS, meta).find(
      (item) => item.id === "procedure",
    );
    const steps = (procedure?.blocks ?? []).filter(
      (block): block is StepBlock => block.kind === "step",
    );
    expect(steps).toHaveLength(9);
    expect(steps.map((step) => step.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(steps[0]).toMatchObject({
      id: "s1",
      title: "Download the treasury statement",
      at: 42,
      time: "0:42",
    });
    expect(steps[4].decision?.branches).toHaveLength(2);
    expect(steps[3].warning).toContain("payroll month");
    expect(steps[8].system).toBeNull();
  });

  it("omits empty sections and renumbers the rest", () => {
    const process = edit((p) => {
      p.systems = [];
      p.prerequisites = ["  "];
      p.glossary = [];
      p.frequency = null;
    });
    const sections = documentSections(process, meta);
    expect(
      sections.filter((item) => item.number !== null).map((item) => item.id),
    ).toEqual([
      "purpose",
      "when",
      "roles",
      "procedure",
      "exceptions",
      "controls",
      "questions",
    ]);
    expect(sections.map((item) => item.number)).toEqual([
      null,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      null,
    ]);
    const when = sections.find((item) => item.id === "when");
    expect(when?.blocks).toEqual([
      { kind: "keyValue", rows: [{ key: "Trigger", value: process.trigger }] },
    ]);
  });

  it("keeps the cover and the closing note for an empty Process", () => {
    const empty: Process = {
      ...SAMPLE_PROCESS,
      purpose: "",
      scope: "",
      trigger: "",
      frequency: null,
      roles: [],
      systems: [],
      prerequisites: [],
      steps: [],
      exceptions: [],
      controls: [],
      glossary: [],
      openQuestions: [],
    };
    const sections = documentSections(empty, meta);
    expect(sections.map((item) => item.id)).toEqual(["cover", "made"]);
  });

  it("gives a step without a usable time no time", () => {
    const process = edit((p) => {
      p.steps[0].at = Number.NaN;
    });
    const procedure = documentSections(process, meta).find(
      (item) => item.id === "procedure",
    );
    const first = procedure?.blocks.find((block) => block.kind === "step");
    expect(first).toMatchObject({ at: null, time: null });
  });

  it("mentions the Checks in the closing note when given", () => {
    const made = documentSections(SAMPLE_PROCESS, meta).at(-1);
    expect(JSON.stringify(made)).toContain("Checks: 8 of 9 Checks passed");
  });
});

describe("documentDate", () => {
  it("prints the UTC date in words and passes nonsense through", () => {
    expect(documentDate("2026-01-05T23:59:00Z")).toBe("5 January 2026");
    expect(documentDate("not a date")).toBe("not a date");
  });
});
