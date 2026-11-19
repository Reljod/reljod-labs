"use client";

import { useEffect, useState } from "react";
import { AUDIT_ACTIONS, type AuditEvent, MCP_PATH } from "../domain/api";
import { CHECKS, DRIVERS, TOOLS } from "../domain/contract";
import { LIMITS, RUN_LIMITS } from "../domain/limits";
import type { Calibration } from "../domain/score";
import { mintMcpToken } from "../server/actions";
import { SKILLS } from "../skills";
import { api } from "./api";
import { CalibrationTable } from "./rules";
import { Button, ErrorNote, Panel, Tag, useWrite } from "./ui";
import { type ExaminationView, money, seconds } from "./view";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="outline-box rounded-sm bg-paper px-3 py-2">
      <p className="eyebrow text-[0.62rem] text-ink-muted">{label}</p>
      <p className="font-mono text-lg font-bold">{value}</p>
    </div>
  );
}

/**
 * Under the hood: exactly what ran in the open Examination (model calls with
 * tokens and cost, every tool call, every code run with its output, which
 * Findings came from the Sweep and which from the Examiner), the harness's
 * caps, and the Sweep's Calibration on the Corpus.
 */
export function Hood({
  view,
  title,
  calibration,
}: {
  view: ExaminationView | null;
  title: string | null;
  /** The Default Rulebook on the Corpus, computed on the server. */
  calibration: Calibration;
}) {
  const tools = view ? Object.values(view.tools) : [];
  const runs = view ? Object.values(view.code) : [];
  const counted = view?.findings.filter((f) => f.weight !== "context") ?? [];
  const bySweep = counted.filter((f) => f.foundBy.includes("sweep")).length;
  const byExaminer = counted.filter(
    (f) => f.foundBy.includes("examiner") || f.foundBy.includes("client"),
  ).length;
  const tokensIn = view?.calls.reduce((sum, c) => sum + c.inputTokens, 0) ?? 0;
  const tokensOut =
    view?.calls.reduce((sum, c) => sum + c.outputTokens, 0) ?? 0;
  const cached =
    view?.calls.reduce((sum, c) => sum + c.cachedInputTokens, 0) ?? 0;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-5">
        <Panel
          eyebrow="This Examination"
          title={title ?? "Open an Examination to see what ran"}
        >
          {view ? (
            <div className="space-y-4" data-testid="loupe-hood">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Examiner turns"
                  value={String(view.calls.length)}
                />
                <Stat label="Tool calls" value={String(tools.length)} />
                <Stat label="Code runs" value={String(runs.length)} />
                <Stat label="Cost" value={money(view.costUsd)} />
                <Stat label="Tokens in" value={tokensIn.toLocaleString()} />
                <Stat label="Cached" value={cached.toLocaleString()} />
                <Stat label="Tokens out" value={tokensOut.toLocaleString()} />
                <Stat
                  label="Measurements"
                  value={String(view.measurements.length)}
                />
              </div>
              <p className="flex flex-wrap gap-1.5 text-xs">
                <Tag tone="ink">{view.model ?? "no model"}</Tag>
                {view.driver ? <Tag>{DRIVERS[view.driver]}</Tag> : null}
                <Tag>Rulebook v{view.rulebookVersion ?? 0}</Tag>
                <Tag tone="blue">{bySweep} Findings from the Sweep</Tag>
                <Tag tone="blue">{byExaminer} from the Examiner</Tag>
                {view.skills.map((skill) => (
                  <Tag key={skill} tone="brass">
                    Skill: {SKILLS[skill].title}
                  </Tag>
                ))}
              </p>
              {view.calls.length ? (
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-ink border-b-2">
                      <th className="py-1">Turn</th>
                      <th className="py-1">In</th>
                      <th className="py-1">Cached</th>
                      <th className="py-1">Out</th>
                      <th className="py-1">Time</th>
                      <th className="py-1">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.calls.map((call, index) => (
                      <tr key={call.seq} className="border-ink/10 border-b">
                        <td className="py-1">{index + 1}</td>
                        <td className="py-1">
                          {call.inputTokens.toLocaleString()}
                        </td>
                        <td className="py-1">
                          {call.cachedInputTokens.toLocaleString()}
                        </td>
                        <td className="py-1">
                          {call.outputTokens.toLocaleString()}
                        </td>
                        <td className="py-1">{seconds(call.ms)}</td>
                        <td className="py-1">{money(call.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Pick a document on the Examine tab, then come back here.
            </p>
          )}
        </Panel>

        {runs.length ? (
          <Panel
            eyebrow={`${runs.length} runs in the sandbox`}
            title="Every piece of code, with its output"
            bodyClassName="p-0"
          >
            <ul className="divide-y-2 divide-ink/10">
              {runs.map((run) => (
                <li key={run.callId} className="px-4 py-2 text-xs">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-1.5">
                      <Tag tone={run.check ? "blue" : "ink"}>
                        {run.check
                          ? CHECKS[run.check].label
                          : run.callId === "sweep"
                            ? "Sweep"
                            : "Examiner's code"}
                      </Tag>
                      <Tag
                        tone={
                          run.exitCode === 0
                            ? "green"
                            : run.exitCode < 0
                              ? "neutral"
                              : "red"
                        }
                      >
                        {run.exitCode < 0 ? "running" : `exit ${run.exitCode}`}
                      </Tag>
                      <span className="font-mono text-ink-muted">
                        {seconds(run.ms)}
                      </span>
                    </summary>
                    <pre className="mt-1.5 max-h-64 overflow-auto rounded-sm bg-ink p-2.5 font-mono text-[0.7rem] text-paper">
                      {run.code}
                    </pre>
                    {run.stdout ? (
                      <pre className="mt-1 max-h-40 overflow-auto rounded-sm border-2 border-ink/20 bg-marble p-2 font-mono text-[0.68rem] whitespace-pre-wrap">
                        {run.stdout.slice(0, 3000)}
                      </pre>
                    ) : null}
                    {run.stderr ? (
                      <pre className="mt-1 max-h-32 overflow-auto rounded-sm border-2 border-seal-red/40 p-2 font-mono text-[0.68rem] whitespace-pre-wrap text-seal-red">
                        {run.stderr.slice(0, 1500)}
                      </pre>
                    ) : null}
                  </details>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Panel
          eyebrow="How it works"
          title="One Examiner, tools, and a harness that owns the gates"
        >
          <div className="space-y-3 text-sm">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                <strong>Sweep.</strong> Code runs {Object.keys(CHECKS).length}{" "}
                Checks in a sandbox with no network, before any model: file
                structure, fonts and glyphs, arithmetic, dates, check digits,
                error level, noise, JPEG ghosts, copy-move, halos.
              </li>
              <li>
                <strong>Look.</strong> The Examiner (a vision model) looks at
                each page and zooms where money, dates and names sit.
              </li>
              <li>
                <strong>Suspect, then prove.</strong> Each suspicion is a
                Hypothesis. It is tested with a Check or with Python the
                Examiner writes; only a Measurement from code can support it.
              </li>
              <li>
                <strong>Rules decide.</strong> A Measurement past its Rule's
                threshold is a Finding; the Rulebook turns Findings into
                Genuine, Suspicious or Tampered. The model's opinion is not an
                input.
              </li>
            </ol>
            <p className="flex flex-wrap gap-1.5">
              {(Object.keys(TOOLS) as (keyof typeof TOOLS)[]).map((tool) => (
                <Tag key={tool} title={TOOLS[tool].hint}>
                  {tool}
                </Tag>
              ))}
            </p>
            <p className="text-xs text-ink-muted">
              The harness caps an Examination at {RUN_LIMITS.turns} turns,{" "}
              {RUN_LIMITS.codeRuns} code runs, {RUN_LIMITS.checkRuns} Checks,{" "}
              {RUN_LIMITS.looks} looks and ${RUN_LIMITS.costUsd.toFixed(2)}, and
              an Owner at {LIMITS.examinationsPerOwnerPerDay} Examinations a
              day. `finish` is refused until every page was looked at, every
              Sweep Finding reviewed and every Hypothesis settled. The same
              tools are the MCP server at {MCP_PATH}.
            </p>
          </div>
        </Panel>
      </div>

      <div className="space-y-5 self-start">
        <Panel
          eyebrow="Calibration"
          title="The Sweep alone, Default Rulebook, on the Corpus"
        >
          <CalibrationTable draft={calibration} />
        </Panel>
        <AuditPanel />
      </div>
    </div>
  );
}

function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api
      .audit({ signal: controller.signal })
      .then(setEvents)
      .catch(() => {
        if (!controller.signal.aborted) setEvents([]);
      });
    return () => controller.abort();
  }, []);
  return (
    <Panel
      eyebrow="Audit trail"
      title="Your writes, append-only"
      bodyClassName="p-0"
    >
      {events === null ? (
        <p className="p-4 text-sm text-ink-muted" aria-busy="true">
          Loading…
        </p>
      ) : events.length === 0 ? (
        <p className="p-4 text-sm text-ink-muted">Nothing yet.</p>
      ) : (
        <ul
          className="max-h-80 divide-y-2 divide-ink/10 overflow-y-auto text-xs"
          data-testid="loupe-audit"
        >
          {events.slice(0, 60).map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center gap-1.5 px-4 py-1.5"
            >
              <span className="font-semibold">
                {AUDIT_ACTIONS[event.action]}
              </span>
              {event.via === "mcp" ? <Tag tone="blue">via MCP</Tag> : null}
              <span className="ml-auto font-mono text-ink-muted">
                {new Date(event.at).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Connect a client: a per-Owner token for the Loupe MCP server, shown once. */
export function Connect() {
  const [token, setToken] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mint = useWrite(async () => {
    setError(null);
    const minted = await mintMcpToken();
    if ("error" in minted) return setError(minted.error);
    setToken(minted);
    setCopied(false);
  });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const command = `claude mcp add --transport http loupe ${origin}${MCP_PATH} --header "Authorization: Bearer ${token?.token ?? "<token>"}"`;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel eyebrow="Connect a client" title="Loupe is an MCP server">
        <div className="space-y-3 text-sm">
          <p>
            Everything on this page is a tool on one MCP server, the same one
            Loupe's own Examiner uses. Mint a token and Claude (or any MCP
            client) can examine documents for you, under your Rules, your limits
            and your Audit trail.
          </p>
          <Button
            variant="primary"
            pending={mint.pending}
            pendingLabel="Minting…"
            onClick={() => mint.run()}
            data-testid="loupe-mint"
          >
            Mint a token
          </Button>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          {token ? (
            <div className="space-y-2">
              <p className="text-xs text-ink-muted">
                Shown once, never stored. It acts as you until{" "}
                {new Date(token.expiresAt).toLocaleString()}.
              </p>
              <pre
                className="overflow-x-auto rounded-sm bg-ink p-3 font-mono text-[0.7rem] break-all whitespace-pre-wrap text-paper"
                data-testid="loupe-token-command"
              >
                {command}
              </pre>
              <Button
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(command).catch(() => {});
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy the command"}
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>
      <Panel eyebrow="Tools" title="What a client can do">
        <ul className="space-y-1.5 text-sm">
          {[
            ["list_samples, create_upload", "pick a Sample or bring a file"],
            [
              "start_examination",
              "with Loupe's Examiner, the Sweep alone, or mode \"client\": you drive the Examiner's tools yourself",
            ],
            [
              "get_examination, get_evidence",
              "the Verdict, Findings and Evidence images",
            ],
            ["run_check", "one named Check on a page or a region"],
            [
              "look, run_code, hypothesize, conclude, review_finding, finish",
              "the Examiner's own tools, on an Examination you drive",
            ],
            [
              "list_rules, edit_rule, reevaluate",
              "the Rulebook, versioned, and a new Verdict with no model call",
            ],
            [
              "read_trail, get_calibration",
              "the Trail, your Audit trail, the error rates on the Corpus",
            ],
          ].map(([name, what]) => (
            <li key={name}>
              <code className="font-mono text-xs font-bold">{name}</code>
              <span className="text-ink-muted">: {what}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
