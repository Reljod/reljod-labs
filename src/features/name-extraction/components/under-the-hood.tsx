"use client";

import { LayoutGroup, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type {
  ModelChoice,
  RulebookVersion,
  RunSummary,
} from "../domain/contract";
import { ConnectClient } from "./connect-client";
import { HowItWorks } from "./how-it-works";
import { ModelsCost } from "./models-cost";
import type { RunView } from "./run-view";
import { RunsHistory } from "./runs-history";
import { cx } from "./ui";

const loading = () => (
  <div className="h-64 animate-pulse rounded-md border border-ink/10 bg-paper/60" />
);
const RulesEditor = dynamic(
  () => import("./rules-editor").then((module) => module.RulesEditor),
  { loading },
);
const AuditLog = dynamic(
  () => import("./audit-log").then((module) => module.AuditLog),
  { loading },
);

export const MCP_PATH = "/api/name-extraction/mcp";

const MCP_TOOLS = [
  { name: "list_corpus", hint: "The demo documents" },
  { name: "extract_names", hint: "Starts a run on a demo document" },
  { name: "get_run", hint: "A run's status, names, cost and score" },
  { name: "get_rulebook", hint: "The rules in force, with their version" },
] as const;

const TABS = [
  { id: "how", label: "How it works" },
  { id: "rules", label: "Rules" },
  { id: "audit", label: "Audit trail" },
  { id: "runs", label: "Past runs" },
  { id: "models", label: "Models & cost" },
  { id: "connect", label: "Connect an AI client" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Connect() {
  // Read after mount, so the server and the first client render agree.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <div className="flex max-w-3xl flex-col gap-3 rounded-md border border-ink/15 bg-paper p-4 text-sm">
      <p>
        Sieve is also an MCP server: Claude, or any MCP client, can list the
        documents, start a run and read its result.
      </p>
      <code className="block rounded-sm bg-marble px-2 py-1.5 font-mono text-xs [overflow-wrap:anywhere]">
        {origin}
        {MCP_PATH}
      </code>
      <ul className="flex flex-col gap-0.5">
        {MCP_TOOLS.map((tool) => (
          <li key={tool.name} className="text-xs">
            <code className="font-mono font-semibold">{tool.name}</code>{" "}
            <span className="text-ink-muted">{tool.hint}</span>
          </li>
        ))}
      </ul>
      <ConnectClient endpoint={`${origin}${MCP_PATH}`} />
    </div>
  );
}

/**
 * The depth, for those who want it: how it works, the editable rules, the
 * audit trail, past runs, models and cost, and the MCP connection.
 */
export function UnderTheHood({
  view,
  runId,
  title,
  runs,
  runsError,
  models,
  onModels,
  onOpenRun,
  onRefreshRuns,
  onRulesSaved,
}: {
  view: RunView | null;
  runId: string | null;
  title: string;
  runs: RunSummary[] | null;
  runsError: string | null;
  models: ModelChoice;
  onModels: (models: ModelChoice) => void;
  onOpenRun: (run: RunSummary) => void;
  onRefreshRuns: () => void;
  onRulesSaved: (version: RulebookVersion) => void;
}) {
  const [tab, setTab] = useState<TabId>("how");
  return (
    <section
      id="sv-under-the-hood"
      aria-labelledby="sv-under-title"
      className="flex flex-col gap-5 border-ink/15 border-t pt-10"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="sv-under-title"
          className="font-mono text-2xl font-bold uppercase sm:text-3xl"
        >
          Under the hood
        </h2>
        <p className="text-sm text-ink-muted">
          For the technically curious. Everything here is live.
        </p>
      </div>
      <LayoutGroup id="sv-hood">
        <div
          role="tablist"
          aria-label="Under the hood"
          className="sv-scroll -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`sv-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`sv-panel-${item.id}`}
              onClick={() => setTab(item.id)}
              className={cx(
                "relative h-9 shrink-0 rounded-full px-4 font-mono text-xs font-bold uppercase transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue",
                tab === item.id
                  ? "text-paper"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {tab === item.id ? (
                <motion.span
                  layoutId="sv-hood-tab"
                  className="absolute inset-0 rounded-full bg-ink"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <span className="relative">{item.label}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>
      <div
        role="tabpanel"
        id={`sv-panel-${tab}`}
        aria-labelledby={`sv-tab-${tab}`}
      >
        {tab === "how" ? <HowItWorks loaded={view?.skills ?? []} /> : null}
        {tab === "rules" ? <RulesEditor onSaved={onRulesSaved} /> : null}
        {tab === "audit" ? (
          runId && view ? (
            <AuditLog events={view.events} runId={runId} title={title} />
          ) : (
            <p className="text-sm text-ink-muted">
              Open a run (or start one) to read its audit trail: every model
              call with its cost, every step with its input and output.
            </p>
          )
        ) : null}
        {tab === "runs" ? (
          <RunsHistory
            runs={runs}
            error={runsError}
            openId={runId}
            onRefresh={onRefreshRuns}
            onOpen={onOpenRun}
          />
        ) : null}
        {tab === "models" ? (
          <ModelsCost models={models} onModels={onModels} view={view} />
        ) : null}
        {tab === "connect" ? <Connect /> : null}
      </div>
    </section>
  );
}
