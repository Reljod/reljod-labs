import type {
  LogTone,
  LogLine as TerminalLine,
} from "@/components/ui/terminal";
import type { FieldCheck } from "./domain/field-checks";
import type {
  DocumentJudgments,
  DocumentKind,
  FieldReading,
} from "./domain/types";
import { DOCUMENT_ORDER, type ScanEvent, type ScanStage } from "./scan-events";
import type { FindingView, RunView } from "./view";

export type StageState = "idle" | "active" | "done" | "error";

export type DocumentScan = {
  kind: DocumentKind;
  parser: string | null;
  pageCount: number;
  spans: Extract<ScanEvent, { type: "spans" }>["spans"];
  /** In the order the model finished writing them; a retry replaces by name. */
  readings: FieldReading[];
  checks: FieldCheck[] | null;
  judgments: DocumentJudgments | null;
  stages: Record<ScanStage, StageState>;
};

export type { LogTone };
export type LogLine = TerminalLine & { kind: DocumentKind | null };

export type ScanState = {
  documents: Record<DocumentKind, DocumentScan>;
  log: LogLine[];
  findings: FindingView[] | null;
  end: { status: "completed" | "failed"; error?: string } | null;
  startedAt: number | null;
  /** Events applied so far: where a reconnect resumes the stream. */
  received: number;
};

const SHORT: Record<DocumentKind, string> = {
  identity_document: "identity",
  proof_of_address: "address",
  certified_copy: "certified",
};

function emptyDocument(kind: DocumentKind): DocumentScan {
  return {
    kind,
    parser: null,
    pageCount: 1,
    spans: [],
    readings: [],
    checks: null,
    judgments: null,
    stages: { parse: "idle", read: "idle", check: "idle" },
  };
}

export function initialScanState(): ScanState {
  return {
    documents: {
      identity_document: emptyDocument("identity_document"),
      proof_of_address: emptyDocument("proof_of_address"),
      certified_copy: emptyDocument("certified_copy"),
    },
    log: [],
    findings: null,
    end: null,
    startedAt: null,
    received: 0,
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const CHECK_TONE: Record<FieldCheck["outcome"], LogTone> = {
  pass: "ok",
  fail: "bad",
  needs_review: "warn",
  read: "muted",
};
const CHECK_MARK: Record<FieldCheck["outcome"], string> = {
  pass: "✓",
  fail: "✕",
  needs_review: "!",
  read: "·",
};
const OUTCOME_WORD = { pass: "PASS", fail: "FAIL", needs_review: "REVIEW" };

/** The terminal lines one event prints. */
function linesFor(event: ScanEvent): Omit<LogLine, "id" | "at">[] {
  switch (event.type) {
    case "stage": {
      const kind = event.kind;
      const name = `${event.stage.padEnd(5)} ${SHORT[kind]}`;
      if (event.state === "start") {
        return [{ tone: "info", kind, text: `▸ ${name}` }];
      }
      if (event.state === "retry") {
        return [
          { tone: "warn", kind, text: `↻ ${name} · attempt ${event.attempt}` },
        ];
      }
      if (event.state === "error") {
        return [{ tone: "bad", kind, text: `✕ ${name} · ${event.detail}` }];
      }
      return [
        {
          tone: "ok",
          kind,
          text: `✓ ${name} · ${seconds(event.ms ?? 0)}${event.detail ? ` · ${event.detail}` : ""}`,
        },
      ];
    }
    case "spans":
      return [
        {
          tone: "muted",
          kind: event.kind,
          text: `  ↳ ${event.parser} · ${event.pageCount} page${event.pageCount === 1 ? "" : "s"} · ${event.spans.length} spans boxed`,
        },
      ];
    case "field": {
      const { name, value, spanRefs, confidence } = event.reading;
      return [
        {
          tone: "muted",
          kind: event.kind,
          text: `  ↳ ${name} = "${value}" ← [${spanRefs.join(",")}] ${confidence.toFixed(2)}`,
        },
      ];
    }
    case "corrections":
      return event.corrections.map(({ ref, from, to }) => ({
        tone: "info" as const,
        kind: event.kind,
        text: `  ✎ ${ref} "${from}" → "${to}"`,
      }));
    case "checks": {
      const lines = event.checks.map((check) => ({
        tone: CHECK_TONE[check.outcome],
        kind: event.kind,
        text: `  ${CHECK_MARK[check.outcome]} ${check.fieldName} · ${check.note}${
          check.expected && check.outcome !== "pass" && check.outcome !== "read"
            ? ` (expected ${check.expected})`
            : ""
        }`,
      }));
      if (event.judgments.tamperingSuspected) {
        lines.push({
          tone: "warn",
          kind: event.kind,
          text: `  ! tampering suspected · ${event.judgments.notes}`,
        });
      }
      if (!event.judgments.legible) {
        lines.push({
          tone: "warn",
          kind: event.kind,
          text: "  ! legibility in doubt",
        });
      }
      return lines;
    }
    case "findings":
      return [
        { tone: "info", kind: null, text: "▸ evaluate rulebook" },
        ...event.findings.map((finding) => ({
          tone: (finding.outcome === "pass"
            ? "ok"
            : finding.outcome === "fail"
              ? "bad"
              : "warn") as LogTone,
          kind: null,
          text: `  ${OUTCOME_WORD[finding.outcome].padEnd(6)} ${finding.requirementId}`,
        })),
      ];
    case "end":
      return event.status === "completed"
        ? [{ tone: "ok", kind: null, text: "✓ pre-screen complete" }]
        : [{ tone: "bad", kind: null, text: `✕ run failed · ${event.error}` }];
  }
}

function withDocument(
  state: ScanState,
  kind: DocumentKind,
  update: (document: DocumentScan) => DocumentScan,
): ScanState["documents"] {
  return { ...state.documents, [kind]: update(state.documents[kind]) };
}

function applyToDocuments(state: ScanState, event: ScanEvent) {
  switch (event.type) {
    case "stage":
      return withDocument(state, event.kind, (document) => {
        const stages = {
          ...document.stages,
          [event.stage]:
            event.state === "error"
              ? "error"
              : event.state === "done"
                ? "done"
                : "active",
        };
        // A retried read starts over, so its earlier readings go.
        const restart = event.stage === "read" && event.state === "retry";
        return {
          ...document,
          stages,
          readings: restart ? [] : document.readings,
        };
      });
    case "spans":
      return withDocument(state, event.kind, (document) => ({
        ...document,
        parser: event.parser,
        pageCount: event.pageCount,
        spans: event.spans,
      }));
    case "field":
      return withDocument(state, event.kind, (document) => ({
        ...document,
        readings: [
          ...document.readings.filter(
            (reading) => reading.name !== event.reading.name,
          ),
          event.reading,
        ],
      }));
    case "corrections": {
      const fixed = new Map(event.corrections.map(({ ref, to }) => [ref, to]));
      return withDocument(state, event.kind, (document) => ({
        ...document,
        spans: document.spans.map((span) => ({
          ...span,
          text: fixed.get(span.ref) ?? span.text,
        })),
      }));
    }
    case "checks":
      return withDocument(state, event.kind, (document) => ({
        ...document,
        checks: event.checks,
        judgments: event.judgments,
        stages: { ...document.stages, check: "done" },
      }));
    default:
      return state.documents;
  }
}

export function scanReducer(state: ScanState, event: ScanEvent): ScanState {
  const startedAt = state.startedAt ?? event.at;
  const lines = linesFor(event).map((line, index) => ({
    ...line,
    id: state.log.length + index,
    at: event.at - startedAt,
  }));
  return {
    documents: applyToDocuments(state, event),
    log: [...state.log, ...lines],
    findings: event.type === "findings" ? event.findings : state.findings,
    end:
      event.type === "end"
        ? { status: event.status, error: event.error }
        : state.end,
    startedAt,
    received: state.received + 1,
  };
}

/** Rebuilds the events of a stored run, so it can be replayed like a live one. */
export function replayEvents(view: RunView): ScanEvent[] {
  const events: ScanEvent[] = [];
  const at = 0;
  const ordered = [...view.documents].sort(
    (a, b) => DOCUMENT_ORDER.indexOf(a.kind) - DOCUMENT_ORDER.indexOf(b.kind),
  );
  for (const document of ordered) {
    const kind = document.kind;
    events.push(
      { at, type: "stage", kind, stage: "parse", state: "start" },
      {
        at,
        type: "spans",
        kind,
        parser: document.parser,
        pageCount: document.pageCount,
        spans: document.spans,
      },
      {
        at,
        type: "stage",
        kind,
        stage: "parse",
        state: "done",
        detail: `${document.parser} · ${document.spans.length} spans`,
      },
      { at, type: "stage", kind, stage: "read", state: "start" },
      ...document.fields.map(
        (field): ScanEvent => ({
          at,
          type: "field",
          kind,
          reading: {
            name: field.name,
            value: field.value,
            spanRefs: field.spanRefs,
            confidence: field.confidence ?? 0,
          },
        }),
      ),
      {
        at,
        type: "stage",
        kind,
        stage: "read",
        state: "done",
        detail: `${document.fields.length} fields`,
      },
      {
        at,
        type: "checks",
        kind,
        checks: document.checks,
        judgments: {
          legible: true,
          tamperingSuspected: false,
          tamperingSpanRefs: [],
          signaturePresent: null,
          notes: "",
        },
      },
    );
  }
  if (view.status === "completed") {
    events.push({ at, type: "findings", findings: view.findings });
  }
  events.push(
    view.status === "failed"
      ? { at, type: "end", status: "failed", error: view.error ?? "" }
      : { at, type: "end", status: "completed" },
  );
  return events;
}
