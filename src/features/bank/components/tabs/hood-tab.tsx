"use client";

import { useEffect, useState } from "react";
import { CHAT_LOCAL_TOOLS, type SessionSummary } from "../../domain/chat";
import { COMMANDS, HUMAN_ONLY, MCP_COMMANDS } from "../../domain/commands";
import { LIMITS } from "../../domain/limits";
import type { AuditPage, RulesView } from "../../domain/views";
import { SKILLS } from "../../skills";
import { chatApi, type SessionDetail } from "../api";
import { Badge, ErrorNote, inputClass, Panel } from "../ui";
import { useBank, useRead } from "../use-bank";

const STAGES: { title: string; note: string }[] = [
  {
    title: "You (the app) or the Teller / Claude (MCP)",
    note: "Both send a command from the same list. A tool is a command; the app's buttons are commands.",
  },
  {
    title: "Command engine",
    note: "Validate (zod) → Role → claim the idempotency key → Confirmation if an agent asked for a sensitive write → Approval if a Rule's threshold is passed → the handler. One transaction.",
  },
  {
    title: "bank.post_entry",
    note: "Lock the accounts in id order → check the available funds → a balanced entry → sealed. The database refuses anything else.",
  },
  {
    title: "Outbox → Workflows",
    note: "A message written in the same transaction starts one durable Workflow, once: clearing, end-of-day, the review deadline, disbursement, statements, notifications, growth.",
  },
];

const CAPS: [string, string][] = [
  ["Messages to the Teller an hour", String(LIMITS.messagesPerHour)],
  ["Model steps in one turn", String(LIMITS.stepsPerChatTurn)],
  ["Characters in a message", String(LIMITS.messageChars)],
  ["Sandbox runs an hour", String(LIMITS.sandboxRunsPerHour)],
  ["Changes to the bank an hour", String(LIMITS.writesPerHour)],
  ["Minutes a Confirmation waits", String(LIMITS.confirmationMinutes)],
  ["Growth requests a day", String(LIMITS.growthPerDay)],
];

/** What ran, exactly: the architecture, the Teller's turns with their cost, the tools, Skills and Rules. */
export function HoodTab() {
  const { tab, sessionId, openTab } = useBank();
  const visible = tab === "hood";
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [chosen, setChosen] = useState<string | null>(sessionId);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const rules = useRead<RulesView>("list_rules", {}, { enabled: visible });
  const audit = useRead<AuditPage>(
    "list_audit",
    chosen ? { sessionId: chosen, limit: 60 } : {},
    { enabled: visible && Boolean(chosen) },
  );

  useEffect(() => {
    if (!visible) return;
    chatApi
      .sessions()
      .then(({ sessions: found }) => {
        setSessions(found);
        setChosen((before) => before ?? found[0]?.id ?? null);
      })
      .catch((caught: Error) => setError(caught.message));
  }, [visible]);
  useEffect(() => {
    if (!visible || !chosen) return;
    chatApi
      .session(chosen)
      .then(setDetail)
      .catch((caught: Error) => setError(caught.message));
  }, [visible, chosen]);

  const turns = (detail?.messages ?? []).filter(
    (message) => message.role === "teller",
  );
  const cost = turns.reduce((sum, turn) => sum + (turn.costUsd ?? 0), 0);
  const tokens = turns.reduce(
    (sum, turn) => sum + (turn.inputTokens ?? 0) + (turn.outputTokens ?? 0),
    0,
  );
  const calls = turns.reduce(
    (sum, turn) =>
      sum + turn.parts.filter((part) => part.type === "tool").length,
    0,
  );
  const shown = COMMANDS.filter((command) =>
    `${command.name} ${command.title}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <div className="tb-scroll h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-3 sm:p-5">
        <Panel eyebrow="Under the hood" title="How it is built">
          <ol className="grid gap-2 md:grid-cols-4">
            {STAGES.map((stage, index) => (
              <li
                key={stage.title}
                className="outline-box rounded-sm bg-paper p-3 text-xs"
              >
                <p className="eyebrow">{index + 1}</p>
                <p className="mt-1 font-semibold text-sm">{stage.title}</p>
                <p className="mt-1">{stage.note}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm">
            The harness owns the caps, the permissions and the confirmation
            gate. The model owns none of them.
          </p>
        </Panel>

        <Panel
          eyebrow="The Teller's turns"
          title="Every model call and tool call"
          actions={
            <select
              className={inputClass}
              aria-label="Conversation"
              value={chosen ?? ""}
              onChange={(event) => setChosen(event.target.value || null)}
            >
              {sessions.length === 0 ? (
                <option value="">No conversations yet</option>
              ) : null}
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
          }
        >
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <p data-testid="bank-hood-turns" className="text-sm tabular-nums">
            {turns.length} turn(s), {calls} tool call(s),{" "}
            {tokens.toLocaleString("en")} tokens, ${cost.toFixed(4)}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {turns.map((turn) => (
              <li
                key={turn.id}
                className="outline-box rounded-sm bg-paper p-2 text-xs"
              >
                <p className="font-semibold tabular-nums">
                  {turn.model ?? "no model (stopped or stubbed)"} ·{" "}
                  {turn.inputTokens ?? 0} in, {turn.outputTokens ?? 0} out
                  {turn.costUsd !== null
                    ? ` · $${turn.costUsd.toFixed(4)}`
                    : ""}
                </p>
                <ul className="mt-1">
                  {turn.parts.map((part) =>
                    part.type === "tool" ? (
                      <li key={part.id}>
                        <Badge tone={part.ok ? "green" : "red"}>
                          {part.ok ? "ok" : "refused"}
                        </Badge>{" "}
                        <code>{part.name}</code> {part.summary}
                      </li>
                    ) : null,
                  )}
                </ul>
              </li>
            ))}
          </ul>
          {audit.data && audit.data.events.length > 0 ? (
            <details className="mt-3 text-xs">
              <summary className="press cursor-pointer font-semibold">
                Audit events of this conversation ({audit.data.events.length})
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {audit.data.events.map((event) => (
                  <li key={event.id}>
                    <code>{event.action}</code> {event.summary}
                    {event.costUsd !== null
                      ? ` ($${event.costUsd.toFixed(4)})`
                      : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Panel>

        <Panel eyebrow="Caps" title="What bounds the Teller">
          <table className="w-full max-w-md text-sm">
            <tbody>
              {CAPS.map(([label, value]) => (
                <tr key={label} className="border-ink/15 border-b">
                  <td className="py-1">{label}</td>
                  <td className="py-1 text-right tabular-nums">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          eyebrow="Tools"
          title={
            <span>
              <span data-testid="bank-hood-tools-count">
                {MCP_COMMANDS.length}
              </span>{" "}
              MCP tools, one per command
            </span>
          }
          actions={
            <input
              className={inputClass}
              placeholder="Search commands"
              aria-label="Search commands"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          }
        >
          <p className="text-sm">
            Never a tool: <code>{HUMAN_ONLY.join("</code>, <code>")}</code>. No
            tool gives an Approval, and the Teller cannot confirm its own
            request. In the chat only:{" "}
            <code>{CHAT_LOCAL_TOOLS.join(", ")}</code>.
          </p>
          <ul className="mt-2 grid gap-1.5 md:grid-cols-2">
            {shown.map((command) => (
              <li
                key={command.name}
                className="rounded-sm border border-ink/25 bg-paper p-2 text-xs"
              >
                <p className="flex flex-wrap items-center gap-1.5">
                  <code className="font-semibold">{command.name}</code>
                  <Badge tone={command.kind === "read" ? "neutral" : "blue"}>
                    {command.kind}
                  </Badge>
                  {"sensitive" in command && command.sensitive ? (
                    <Badge tone="amber">waits for you</Badge>
                  ) : null}
                  {"humanOnly" in command && command.humanOnly ? (
                    <Badge tone="ink">a person only</Badge>
                  ) : null}
                  <span className="text-ink/60">{command.action}</span>
                </p>
                <p className="mt-1">{command.description}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          eyebrow="Skills"
          title="SKILL.md text the Teller loads on demand"
        >
          <ul className="flex flex-col gap-1.5">
            {SKILLS.map((skill) => (
              <li key={skill.id}>
                <details className="text-sm">
                  <summary className="press cursor-pointer">
                    <span className="font-semibold">{skill.name}</span>:{" "}
                    {skill.description}
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap rounded-sm border border-ink/20 bg-paper p-2 text-xs">
                    {skill.body}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          eyebrow="Rules applied"
          title="The Rulebook every command runs on"
          actions={
            <button
              type="button"
              className="press font-semibold text-xs underline"
              onClick={() => openTab("rules")}
            >
              Edit in Rules
            </button>
          }
        >
          {rules.error ? <ErrorNote>{rules.error.message}</ErrorNote> : null}
          <ul className="flex flex-col gap-1 text-sm">
            {(rules.data?.rules ?? []).map((rule) => (
              <li key={rule.id}>
                <Badge tone={rule.edited ? "blue" : "neutral"}>
                  {rule.edited ? `Version ${rule.version}` : "Default"}
                </Badge>{" "}
                {rule.sentence}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
