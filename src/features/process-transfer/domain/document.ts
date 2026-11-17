import type { Decision, Process } from "./process";
import { clock } from "./process";

/*
 * The Workflow document as data. The DOCX writer and the page preview both
 * render these sections, so the file a person downloads and the page they
 * read cannot drift apart. No model writes any of it: the same Process and
 * meta always give the same document.
 */

/** What the document says about itself, beyond the Process. */
export type DocumentMeta = {
  /** The Recording's name, as the person knows it (file name or Sample title). */
  recordingName: string;
  /** When the document was generated, ISO 8601. Also the DOCX's created date. */
  generatedAt: string;
  /** Defaults to "0.1". */
  version?: string;
  /** `draft` until a person has checked it against the Recording. */
  status: "draft" | "approved";
  /** One line on the Checks, e.g. "8 of 9 Checks passed; 1 warning". */
  checksSummary?: string | null;
};

export type TableBlock = {
  kind: "table";
  columns: string[];
  /** Relative column widths; they need not add up to 1. */
  widths: number[];
  rows: string[][];
};

/** One step of the Procedure, laid out. */
export type StepBlock = {
  kind: "step";
  id: string;
  /** 1-based, in Procedure order. */
  number: number;
  title: string;
  actor: string;
  system: string | null;
  /** Seconds into the Recording; null when the step has no usable time. */
  at: number | null;
  /** `m:ss`, or null with `at`. */
  time: string | null;
  action: string;
  details: string[];
  warning: string | null;
  decision: Decision | null;
};

export type DocumentBlock =
  | { kind: "paragraph"; text: string; muted?: boolean }
  | { kind: "subheading"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbered"; items: string[] }
  | { kind: "keyValue"; rows: { key: string; value: string }[] }
  | TableBlock
  | StepBlock
  | {
      kind: "callout";
      tone: "note" | "warning";
      title: string;
      text: string;
    };

export type DocumentSection = {
  /** Stable: `cover`, `purpose`, `procedure`, `made`, ... */
  id: string;
  /** 1-based among the numbered sections; null for the cover and the closing note. */
  number: number | null;
  heading: string;
  /** A small label above the heading (the cover's "Workflow document"). */
  eyebrow?: string;
  blocks: DocumentBlock[];
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "17 November 2026", in UTC and without `Intl`, so the server, the browser
 * and the DOCX all print the same date.
 */
export function documentDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function documentStatus(meta: DocumentMeta): string {
  return meta.status === "approved" ? "Approved" : "Draft: verify before use";
}

function has(text: string | null | undefined): text is string {
  return typeof text === "string" && text.trim().length > 0;
}

function list(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

/** The document, section by section. Empty sections are left out and the rest renumbered. */
export function documentSections(
  process: Process,
  meta: DocumentMeta,
): DocumentSection[] {
  const draft = meta.status !== "approved";
  const cover: DocumentSection = {
    id: "cover",
    number: null,
    heading: has(process.title) ? process.title.trim() : "Untitled process",
    eyebrow: "Workflow document",
    blocks: [
      {
        kind: "keyValue",
        rows: [
          { key: "Handed over by", value: process.owner },
          { key: "Taken over by", value: process.receiver },
          { key: "Date", value: documentDate(meta.generatedAt) },
          { key: "Source recording", value: meta.recordingName },
          { key: "Version", value: meta.version ?? "0.1" },
          { key: "Status", value: documentStatus(meta) },
        ].filter((row) => has(row.value)),
      },
      ...(draft
        ? [
            {
              kind: "callout" as const,
              tone: "warning" as const,
              title: "Draft",
              text: "This document was generated from a recording and has not been checked by a person. Walk through it against the recording before you rely on it.",
            },
          ]
        : []),
    ],
  };

  const numbered: Omit<DocumentSection, "number">[] = [];
  const add = (id: string, heading: string, blocks: DocumentBlock[]) => {
    if (blocks.length > 0) numbered.push({ id, heading, blocks });
  };

  add("purpose", "Purpose and scope", [
    ...(has(process.purpose)
      ? [{ kind: "paragraph" as const, text: process.purpose.trim() }]
      : []),
    ...(has(process.scope)
      ? [
          { kind: "subheading" as const, text: "Scope" },
          { kind: "paragraph" as const, text: process.scope.trim() },
        ]
      : []),
  ]);

  const when = [
    { key: "Trigger", value: process.trigger },
    { key: "Frequency", value: process.frequency ?? "" },
  ].filter((row) => has(row.value));
  add(
    "when",
    "When it runs",
    when.length ? [{ kind: "keyValue", rows: when }] : [],
  );

  const roles = process.roles.filter((role) => has(role.name));
  add(
    "roles",
    "Roles and responsibilities",
    roles.length
      ? [
          {
            kind: "table",
            columns: ["Role", "Responsibility"],
            widths: [0.3, 0.7],
            rows: roles.map((role) => [role.name, role.responsibility]),
          },
        ]
      : [],
  );

  const systems = process.systems.filter((system) => has(system.name));
  add(
    "systems",
    "Systems",
    systems.length
      ? [
          {
            kind: "table",
            columns: ["System", "Used for"],
            widths: [0.3, 0.7],
            rows: systems.map((system) => [system.name, system.usedFor]),
          },
        ]
      : [],
  );

  const prerequisites = list(process.prerequisites);
  add(
    "before",
    "Before you start",
    prerequisites.length ? [{ kind: "bullets", items: prerequisites }] : [],
  );

  const steps: StepBlock[] = process.steps.map((step, index) => {
    const at = Number.isFinite(step.at) && step.at >= 0 ? step.at : null;
    return {
      kind: "step",
      id: step.id,
      number: index + 1,
      title: step.title.trim(),
      actor: step.actor.trim(),
      system: has(step.system) ? step.system.trim() : null,
      at,
      time: at === null ? null : clock(at),
      action: step.action.trim(),
      details: list(step.details),
      warning: has(step.warning) ? step.warning.trim() : null,
      decision:
        step.decision && step.decision.branches.length > 0
          ? step.decision
          : null,
    };
  });
  add(
    "procedure",
    "Procedure",
    steps.length
      ? [
          {
            kind: "paragraph",
            text: "Do the steps in order. Each one says who does it, where, and the time in the recording that shows it.",
            muted: true,
          },
          ...steps,
        ]
      : [],
  );

  const exceptions = process.exceptions.filter((item) => has(item.situation));
  add(
    "exceptions",
    "Exceptions",
    exceptions.length
      ? [
          {
            kind: "table",
            columns: ["Situation", "What to do"],
            widths: [0.4, 0.6],
            rows: exceptions.map((item) => [item.situation, item.handling]),
          },
        ]
      : [],
  );

  const controls = list(process.controls);
  add(
    "controls",
    "Controls",
    controls.length ? [{ kind: "bullets", items: controls }] : [],
  );

  const glossary = process.glossary.filter((item) => has(item.term));
  add(
    "glossary",
    "Glossary",
    glossary.length
      ? [
          {
            kind: "table",
            columns: ["Term", "Meaning"],
            widths: [0.3, 0.7],
            rows: glossary.map((item) => [item.term, item.meaning]),
          },
        ]
      : [],
  );

  const questions = list(process.openQuestions);
  add(
    "questions",
    "Open questions",
    questions.length
      ? [
          {
            kind: "paragraph",
            text: "The call left these unanswered. Settle each one with the person handing over before treating this document as complete.",
          },
          { kind: "numbered", items: questions },
        ]
      : [],
  );

  const made: DocumentSection = {
    id: "made",
    number: null,
    heading: "How this document was made",
    blocks: [
      {
        kind: "paragraph",
        text: `Generated on ${documentDate(meta.generatedAt)} from the recording "${meta.recordingName}" by a model pipeline. A model watched the call and noted what was said and shown, a model wrote the process down from those notes, and a second model checked each step against the recording. The document is then laid out from that process by fixed code, not by a model.`,
        muted: true,
      },
      ...(has(meta.checksSummary)
        ? [
            {
              kind: "paragraph" as const,
              text: `Checks: ${meta.checksSummary.trim()}`,
              muted: true,
            },
          ]
        : []),
      {
        kind: "paragraph",
        text: "Models can mishear and misread a screen. Verify every step, value and control against the recording and the people involved before you rely on it.",
        muted: true,
      },
    ],
  };

  return [
    cover,
    ...numbered.map((section, index) => ({ ...section, number: index + 1 })),
    made,
  ];
}
