"use client";

import type { StepSpec } from "../../domain/pipeline";
import { OUTCOME_LABEL, type Outcome } from "../../domain/rules";
import type { Finding, RunView, StepView } from "../../domain/run";
import { formatCost } from "../api";
import { Badge, ErrorNote, Markdown, type Tone } from "../ui";
import { KIND_LABEL, KindIcon, nodeState } from "./flow";
import { formatDuration, formatTokens } from "./format";
import { STEP_STATUS_LABEL, STEP_STATUS_TONE } from "./status";

const OUTCOME_TONE: Record<Outcome, Tone> = {
  block: "red",
  refer: "amber",
  warn: "neutral",
};

export const versionLabel = (version: number) =>
  version === 0 ? "Default" : `v${version}`;

function show(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "–";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

/** A flat object as rows; anything deeper as JSON. */
function ValueRows({ values }: { values: Record<string, unknown> }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
      {entries.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-ink-muted">{name}</dt>
          <dd className="font-mono [overflow-wrap:anywhere]">{show(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What a Step worked out: text as Markdown, a flat object as rows, the rest as JSON. */
export function OutputView({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="text-xs text-ink-muted">No output.</p>;
  }
  if (typeof value === "string") return <Markdown text={value} />;
  if (typeof value !== "object" || Array.isArray(value)) {
    return <p className="font-mono text-xs">{show(value)}</p>;
  }
  const record = value as Record<string, unknown>;
  const flat = Object.values(record).every(
    (item) => item === null || typeof item !== "object",
  );
  if (flat) return <ValueRows values={record} />;
  const json = JSON.stringify(value, null, 2);
  return (
    <pre className="hx-scroll max-h-72 overflow-auto rounded-sm bg-ink/5 p-2 font-mono text-[0.7rem]">
      {json.length > 6000 ? `${json.slice(0, 6000)}\n…` : json}
    </pre>
  );
}

function FindingRow({
  finding,
  ruleTitle,
  onOpenRule,
}: {
  finding: Finding;
  ruleTitle: string;
  onOpenRule: (ruleId: string) => void;
}) {
  return (
    <li className="space-y-1.5 rounded-sm outline-box bg-paper p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onOpenRule(finding.ruleId)}
          title="Open this Rule in Skills"
          className="min-w-0 text-left text-sm font-semibold text-federal-blue underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-federal-blue"
        >
          {ruleTitle}
        </button>
        <Badge tone={finding.met ? "green" : "red"}>
          {finding.met ? "Met" : "Not met"}
        </Badge>
        <Badge
          tone={finding.met ? "neutral" : OUTCOME_TONE[finding.outcome]}
          title={
            finding.met
              ? "The Outcome only applies when the Rule is not met"
              : "What this does to the Run"
          }
        >
          {OUTCOME_LABEL[finding.outcome]}
        </Badge>
        <Badge title="The Rule Version this Run applied">
          {versionLabel(finding.ruleVersion)}
        </Badge>
      </div>
      <p className="text-sm [overflow-wrap:anywhere]">{finding.summary}</p>
      <ValueRows values={finding.compared} />
    </li>
  );
}

/** One Step of a Run: what it did, what it worked out, the Findings it made and where it failed. */
export function StepDetail({
  spec,
  view,
  run,
  ruleTitles,
  onOpenRule,
  now,
}: {
  spec: StepSpec;
  view: StepView | null;
  run: RunView | null;
  ruleTitles: ReadonlyMap<string, string>;
  onOpenRule: (ruleId: string) => void;
  now: number;
}) {
  const findings =
    run?.findings.filter((item) => item.stepId === spec.id) ?? [];
  const approvals =
    run?.approvals.filter((item) => item.stepId === spec.id) ?? [];
  const state = nodeState(spec, view, run?.status ?? null);
  const started = view?.startedAt ? Date.parse(view.startedAt) : null;
  const ended = view?.finishedAt ? Date.parse(view.finishedAt) : now;
  const elapsed = started !== null ? Math.max(0, ended - started) : null;
  const usage = view?.usage ?? null;

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="flex flex-wrap items-center gap-2">
          <KindIcon kind={spec.kind} className="text-ink-muted" />
          <span className="font-semibold">{spec.title}</span>
          <Badge>{KIND_LABEL[spec.kind]}</Badge>
          {view ? (
            <Badge
              tone={
                state === "waiting" ? "amber" : STEP_STATUS_TONE[view.status]
              }
              dot={view.status === "running"}
            >
              {state === "waiting"
                ? "Waiting for Approval"
                : STEP_STATUS_LABEL[view.status]}
            </Badge>
          ) : null}
          {spec.risk === "high" ? <Badge tone="red">High risk</Badge> : null}
          {elapsed !== null ? (
            <span className="font-mono text-xs text-ink-muted">
              {formatDuration(elapsed)}
            </span>
          ) : null}
        </p>
        {spec.summary ? (
          <p className="mt-1 text-xs text-ink-muted">{spec.summary}</p>
        ) : null}
      </div>

      {usage ? (
        <p className="font-mono text-xs text-ink-muted">
          {usage.model} · {formatTokens(usage.inputTokens)} in ·{" "}
          {formatTokens(usage.outputTokens)} out · {formatCost(usage.costUsd)}
        </p>
      ) : null}

      <ErrorNote>{view?.error}</ErrorNote>

      {view ? (
        <section aria-label="Output">
          <h4 className="font-mono text-[0.65rem] font-bold tracking-[0.08em] text-ink-muted uppercase">
            Output
          </h4>
          <div className="mt-1">
            {view.status === "pending" ? (
              <p className="text-xs text-ink-muted">Not started yet.</p>
            ) : view.status === "running" && view.output == null ? (
              <p className="text-xs text-ink-muted">Working…</p>
            ) : (
              <OutputView value={view.output} />
            )}
          </div>
        </section>
      ) : null}

      {findings.length > 0 ? (
        <section aria-label="Findings">
          <h4 className="font-mono text-[0.65rem] font-bold tracking-[0.08em] text-ink-muted uppercase">
            Findings ({findings.length})
          </h4>
          <ul className="mt-1 space-y-2">
            {findings.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                ruleTitle={ruleTitles.get(finding.ruleId) ?? finding.ruleId}
                onOpenRule={onOpenRule}
              />
            ))}
          </ul>
        </section>
      ) : view && view.status === "done" && spec.kind === "code" ? (
        <p className="text-xs text-ink-muted">This Step made no Findings.</p>
      ) : null}

      {approvals.map((approval) => (
        <section
          key={approval.id}
          aria-label="Approval"
          className="rounded-sm outline-box bg-marble/50 p-2.5 text-xs"
        >
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{approval.title}</span>
            <Badge tone={approval.risk === "high" ? "red" : "neutral"}>
              {approval.risk === "high" ? "High risk" : "Low risk"}
            </Badge>
            <Badge
              tone={
                approval.status === "approved"
                  ? "green"
                  : approval.status === "pending"
                    ? "amber"
                    : "neutral"
              }
            >
              {approval.status}
            </Badge>
          </p>
          {approval.decidedBy ? (
            <p className="mt-1 text-ink-muted">
              {approval.status === "approved" ? "Approved" : "Decided"} by{" "}
              {approval.decidedBy.name}
              {approval.note ? `: "${approval.note}"` : "."}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
