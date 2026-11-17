"use client";

import type { ReactNode } from "react";
import { type ModelChoice, PURPOSES } from "../../domain/models";
import type { Rule } from "../../domain/rules";
import { STAGES } from "../../domain/run";
import { modelLabel } from "../cost";
import { maxRounds } from "../deck-rounds";
import { Panel } from "../ui";
import { ModelPickers } from "./model-pickers";

type Stage = (typeof STAGES)[number];

/**
 * The workflow every Run follows: seven Stages in order, the Design ⇄ Check
 * loop drawn as a loop, and Approve's two outcomes. Beside it, the three
 * models the pipeline calls.
 */
export function PipelineView({
  models,
  rules,
  onModelsSaved,
}: {
  models: ModelChoice;
  rules: Rule[];
  onModelsSaved: (models: ModelChoice) => void;
}) {
  const byId = Object.fromEntries(
    STAGES.map((stage, index) => [stage.id, { stage, number: index + 1 }]),
  );
  const card = (id: Stage["id"]) => (
    <StageCard
      stage={byId[id].stage}
      number={byId[id].number}
      models={models}
    />
  );
  const rounds = maxRounds(rules);
  const reviewerOn =
    rules.find((rule) => rule.id === "loop.reviewer")?.enabled ?? true;

  return (
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <section
        aria-labelledby="ho-flow"
        className="flex min-w-0 flex-col gap-4"
      >
        <div>
          <p className="eyebrow text-ink-muted">The workflow</p>
          <h2
            id="ho-flow"
            className="font-mono text-lg font-bold tracking-[0.04em] uppercase"
          >
            From a call to an approved Deck
          </h2>
        </div>
        <ol className="flex flex-col items-stretch">
          <li>{card("watch")}</li>
          <Arrow label="moments of the call" />
          <li>{card("extract")}</li>
          <Arrow label="the Process" />
          <li>{card("verify")}</li>
          <Arrow label="the verified Process" />
          <li>
            {card("document")}
            <Output>Workflow document · DOCX</Output>
          </li>
          <Arrow label="the Process again, for the slides" />
          <li>
            <div className="rounded-sm border-2 border-federal-blue border-dashed p-3">
              <p className="eyebrow mb-2 text-federal-blue">
                Repeats in Rounds{rounds ? `, up to ${rounds}` : ""}
                {reviewerOn ? "" : " · reviewer model off"}
              </p>
              <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                {card("design")}
                <LoopArrows />
                {card("check")}
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                On the last Round, slides that still break a layout or content
                Rule are fit by rule (split or trimmed by code), not by the
                model.
              </p>
            </div>
          </li>
          <Arrow label="the last Round's verdict" />
          <li>
            {card("approve")}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Outcome tone="approved" title="Approved">
                No blocking Check failed and the reviewer raised nothing major.
                The Deck downloads as PPTX.
              </Outcome>
              <Outcome tone="held" title="Held for a person">
                Still failing after the last Round. Adjust the Rules and redo
                the Deck.
              </Outcome>
            </div>
          </li>
        </ol>
      </section>

      <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4">
        <Panel eyebrow="Models" title="Which model does what">
          <ModelPickers models={models} onSaved={onModelsSaved} />
        </Panel>
        <Panel eyebrow="How it runs" title="Durable and auditable">
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              Each Run is a durable workflow (Vercel Workflow SDK): every Stage
              is a step that is retried on its own and survives a restart, and
              the page follows it live.
            </li>
            <li>
              The workflow document is built by rule from the Process. No model
              writes it, so the same Process always gives the same document.
            </li>
            <li>
              Checks are code, not a model&apos;s opinion: each Rule measures
              the Process or the laid-out Deck. A second model reviews on top.
            </li>
            <li>
              A Run keeps the Rules and models it started with. Every model
              call, Rule change, Approval and download is written to the Audit
              trail.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function StageCard({
  stage,
  number,
  models,
}: {
  stage: Stage;
  number: number;
  models: ModelChoice;
}) {
  return (
    <div className="outline-box flex h-full min-w-0 flex-col gap-1.5 rounded-sm bg-paper p-3 shadow-hard-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-ink font-mono text-xs font-bold text-paper">
          {number}
        </span>
        <h3 className="font-mono text-sm font-bold tracking-[0.08em] uppercase">
          {stage.label}
        </h3>
      </div>
      <p className="text-sm">{stage.does}</p>
      <p className="mt-auto pt-1">
        {stage.purpose ? (
          <span className="inline-flex flex-wrap items-center gap-1 rounded-sm bg-morning-haze px-1.5 py-0.5 font-mono text-[11px]">
            <span className="font-bold">
              {PURPOSES[stage.purpose].label} model
            </span>
            <span>· {modelLabel(models[stage.purpose])}</span>
          </span>
        ) : (
          <span className="inline-flex rounded-sm bg-limestone px-1.5 py-0.5 font-mono text-[11px] font-bold">
            No model · by rule
          </span>
        )}
      </p>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <li
      aria-hidden="true"
      className="flex items-center gap-2 py-1 pl-5 text-ink-muted"
    >
      <span className="flex h-7 w-0.5 bg-ink/40" />
      <span className="font-mono text-[10px] tracking-[0.06em] uppercase">
        ↓ {label}
      </span>
    </li>
  );
}

function LoopArrows() {
  return (
    <div
      aria-hidden="true"
      className="flex justify-center gap-4 py-1 font-mono text-[10px] tracking-[0.06em] text-federal-blue uppercase sm:flex-col sm:gap-1 sm:px-1"
    >
      <span className="flex items-center gap-1">
        <span className="hidden text-base sm:inline">→</span>
        <span className="sm:hidden">↓</span> laid-out Deck
      </span>
      <span className="flex items-center gap-1 text-seal-red">
        <span className="hidden text-base sm:inline">←</span>
        <span className="sm:hidden">↑</span> failures
      </span>
    </div>
  );
}

function Output({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 ml-5 inline-flex items-center gap-2 rounded-sm border-2 border-ink/40 border-dashed bg-paper/70 px-2 py-1 font-mono text-[11px] font-bold uppercase">
      <span aria-hidden="true">↳</span>
      {children}
    </p>
  );
}

function Outcome({
  tone,
  title,
  children,
}: {
  tone: "approved" | "held";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-sm border-2 p-3 text-sm ${tone === "approved" ? "border-ivy bg-ivy/10" : "border-seal-red bg-seal-red/5"}`}
    >
      <p
        className={`font-mono text-xs font-bold tracking-[0.12em] uppercase ${tone === "approved" ? "text-ivy" : "text-seal-red"}`}
      >
        {title}
      </p>
      <p className="mt-1">{children}</p>
    </div>
  );
}
