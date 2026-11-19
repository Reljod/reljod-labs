"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  cx,
  ErrorNote,
  inputClass,
  Panel,
  useWrite,
} from "@/features/harness/components/ui";
import type { FirstView } from "../domain/api";
import type { CallEvent, CallView } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { usd } from "../domain/models";
import {
  type ParamSpec,
  type ParamValue,
  type ResolvedRule,
  RULES,
  renderRule,
} from "../domain/rules";
import { SWITCHBOARD_MCP_PATH } from "../domain/tools";
import { RECORD_KINDS, RECORD_LABEL } from "../domain/world";
import {
  callbackNowAction,
  mintMcpTokenAction,
  resetBackOfficeAction,
  restoreRuleAction,
  saveRuleAction,
} from "../server/actions";
import { api } from "./api";
import type { CallController } from "./use-call";
import { VAD_SILENCE_MS } from "./voice-session";

const Loading = () => <p className="text-sm text-ink-muted">Loading…</p>;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// Back office -------------------------------------------------------------------------------

const show = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(show).join(", ")
    : typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value);

export function BackOfficePanel({
  view,
  callId,
  onChanged,
}: {
  view: FirstView | null;
  callId: string | null;
  onChanged: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!view) return <Loading />;
  return (
    <>
      <Panel
        eyebrow="Meridia Rail · SPECIMEN"
        title="Back office"
        actions={
          <Button
            size="sm"
            data-testid="swb-reset"
            onClick={() => setConfirming(true)}
          >
            Reset to the seed
          </Button>
        }
      >
        <p className="text-sm text-ink-muted">
          The railway&rsquo;s records, one copy per visitor. The Agent reaches
          them only through the tools of the MCP server; rows marked{" "}
          <Badge tone="green">this call</Badge> were made or changed by the call
          on screen.
        </p>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        {RECORD_KINDS.map((kind) => {
          const records = view.records.filter((record) => record.kind === kind);
          return (
            <Panel
              key={kind}
              title={RECORD_LABEL[kind]}
              actions={<Badge>{records.length}</Badge>}
              bodyClassName=""
            >
              {records.length === 0 ? (
                <p className="p-4 text-sm text-ink-muted">None yet.</p>
              ) : (
                <ul className="divide-y-2 divide-ink/10">
                  {records.map((record) => (
                    <li
                      key={record.id}
                      className={cx(
                        "flex flex-col gap-1 p-3 text-sm",
                        record.callId && record.callId === callId
                          ? "bg-ivy/10"
                          : "",
                      )}
                      data-testid={`swb-record-${record.kind}`}
                      data-ref={record.ref}
                    >
                      <p className="flex flex-wrap items-center gap-2">
                        <strong className="font-mono">{record.ref}</strong>
                        {record.callId && record.callId === callId ? (
                          <Badge tone="green">this call</Badge>
                        ) : record.callId ? (
                          <Badge>from a call</Badge>
                        ) : null}
                      </p>
                      <p className="text-xs break-words text-ink-muted">
                        {Object.entries(record.data as Record<string, unknown>)
                          .filter(([, value]) => value !== "" && value !== null)
                          .map(([key, value]) => `${key}: ${show(value)}`)
                          .join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })}
      </div>
      {confirming ? (
        <ConfirmDialog
          title="Reset the Back office?"
          confirm="Reset"
          pendingLabel="Resetting…"
          danger
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const result = await resetBackOfficeAction();
            if (!result.ok) throw new Error(result.error);
            await onChanged();
          }}
        >
          Every refund, voucher, report and hand-off made by your calls is
          removed and the bookings go back to the seed. Saved calls, Rules and
          the trail are kept.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

// Wrap-up -----------------------------------------------------------------------------------

const VERDICT = { pass: "green", fail: "red", na: "neutral" } as const;

export function WrapupView({
  call,
  onChanged,
}: {
  call: CallView;
  onChanged: () => void;
}) {
  const wrapup = call.wrapup;
  const callback = useWrite(async () => {
    const result = await callbackNowAction(call.id);
    if (!result.ok) throw new Error(result.error);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    onChanged();
    return true;
  });
  if (!wrapup)
    return (
      <Panel eyebrow="After the call" title="Wrap-up">
        <p className="text-sm text-ink-muted" data-testid="swb-wrapup-pending">
          {call.wrapupStatus === "failed"
            ? "The Wrap-up could not be written for this call."
            : call.status === "live"
              ? "Written when the call ends."
              : "The Workflow is writing it…"}
        </p>
      </Panel>
    );
  const first = wrapup.stats.firstAudio;
  return (
    <Panel
      eyebrow="After the call · a durable Workflow"
      title="Wrap-up"
      bodyClassName="flex flex-col gap-5 p-4"
    >
      <p className="text-sm" data-testid="swb-wrapup">
        {wrapup.summary}
      </p>
      <dl className="grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4">
        {[
          ["Length", `${wrapup.stats.seconds} s`],
          [
            "Tool calls",
            `${wrapup.stats.toolCalls} (${wrapup.stats.refusals} refused)`,
          ],
          ["Barge-ins", String(wrapup.stats.bargeIns)],
          [
            call.line === "voice" ? "Median first audio" : "Median first word",
            first.medianMs === null ? "n/a" : `${first.medianMs} ms`,
          ],
        ].map(([label, value]) => (
          <div key={label} className="outline-box rounded-sm bg-marble p-2">
            <dt className="text-[0.6rem] tracking-wider text-ink-muted uppercase">
              {label}
            </dt>
            <dd className="mt-0.5 text-sm font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      {wrapup.actions.length > 0 ? (
        <div>
          <p className="eyebrow">What was done</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {wrapup.actions.map((action) => (
              <li key={`${action.what}${action.ref}`}>
                {action.ref ? (
                  <strong className="font-mono">{action.ref} </strong>
                ) : null}
                {action.what}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {wrapup.promises.length > 0 ? (
        <div>
          <p className="eyebrow">Promised</p>
          <ul className="mt-1 list-inside list-disc text-sm">
            {wrapup.promises.map((promise) => (
              <li key={promise}>{promise}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {wrapup.sentiment.length > 0 ? (
        <div>
          <p className="eyebrow">The Caller&rsquo;s mood, Turn by Turn</p>
          <div className="mt-2 flex h-16 items-center gap-1.5">
            {wrapup.sentiment.map((point) => (
              <div
                key={point.turn}
                title={`Turn ${point.turn}: ${point.label}`}
                className="flex h-full flex-1 flex-col justify-center"
              >
                <div
                  className={cx(
                    "outline-box w-full rounded-sm",
                    point.score < 0
                      ? "bg-seal-red"
                      : point.score > 0
                        ? "bg-ivy"
                        : "bg-stone",
                  )}
                  style={{
                    height: `${Math.max(12, Math.abs(point.score) * 50)}%`,
                    transform: `translateY(${point.score < 0 ? "50%" : point.score > 0 ? "-50%" : "0"})`,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div>
        <p className="eyebrow">
          Compliance scorecard · by code · {wrapup.scorecard.passed} passed,{" "}
          {wrapup.scorecard.failed} failed
        </p>
        <ul className="mt-2 flex flex-col gap-1.5" data-testid="swb-scorecard">
          {wrapup.scorecard.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-sm">
              <Badge
                tone={VERDICT[item.verdict]}
                className="mt-0.5 w-12 justify-center"
              >
                {item.verdict === "na" ? "n/a" : item.verdict}
              </Badge>
              <span>
                <strong>{item.title}.</strong>{" "}
                <span className="text-ink-muted">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="eyebrow">Follow-ups</p>
        <ul className="mt-1 flex flex-col gap-2 text-sm">
          {wrapup.followUps.map((item) => (
            <li key={item.kind} className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  item.status === "none"
                    ? "neutral"
                    : item.status === "waiting"
                      ? "amber"
                      : "green"
                }
              >
                {item.kind} · {item.status}
              </Badge>
              <span className="text-ink-muted">
                {item.ref ? (
                  <strong className="font-mono text-ink">{item.ref} </strong>
                ) : null}
                {item.detail}
              </span>
              {item.kind === "callback" && item.status === "waiting" ? (
                <Button
                  size="sm"
                  pending={callback.pending}
                  pendingLabel="Waking…"
                  onClick={() => void callback.run()}
                >
                  Wake it now
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {callback.error ? <ErrorNote>{callback.error}</ErrorNote> : null}
      </div>
      {wrapup.analysis ? (
        <div>
          <p className="eyebrow">Counted in the Sandbox (no network)</p>
          <pre className="outline-box mt-1 max-h-40 overflow-auto rounded-sm bg-ink p-2 font-mono text-xs text-paper">
            {wrapup.analysis.output}
          </pre>
        </div>
      ) : null}
      <p className="text-xs text-ink-muted">
        Saved for you: the transcript, the tool calls and these notes. No audio
        is stored. Note by {wrapup.model}
        {wrapup.costUsd > 0 ? `, ${usd(wrapup.costUsd)}` : ""}; the scorecard
        and the numbers are computed by code from the call&rsquo;s events.
      </p>
    </Panel>
  );
}

// Calls -------------------------------------------------------------------------------------

export function CallsPanel({
  view,
  controller,
  onOpen,
  onChanged,
}: {
  view: FirstView | null;
  controller: CallController;
  onOpen: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const { state } = controller;
  if (!view) return <Loading />;
  const busy = state.phase === "live" || state.phase === "connecting";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Panel eyebrow="Saved for you" title="Calls" bodyClassName="">
        {view.calls.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">
            No calls yet. Make one on the Call tab.
          </p>
        ) : (
          <ul className="divide-y-2 divide-ink/10">
            {view.calls.map((call) => (
              <li key={call.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOpen(call.id)}
                  data-testid="swb-call-row"
                  className={cx(
                    "flex w-full flex-col gap-1 p-3 text-left text-sm hover:bg-morning-haze disabled:opacity-60",
                    state.call?.id === call.id ? "bg-morning-haze" : "",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <strong>{when(call.startedAt)}</strong>
                    <Badge>{call.line}</Badge>
                    {call.origin === "mcp" ? (
                      <Badge tone="blue">MCP</Badge>
                    ) : null}
                    <Badge
                      tone={
                        call.status === "cut_off"
                          ? "red"
                          : call.status === "live"
                            ? "amber"
                            : "neutral"
                      }
                    >
                      {call.status.replace("_", " ")}
                    </Badge>
                    {call.refusals > 0 ? (
                      <Badge tone="amber">{call.refusals} refused</Badge>
                    ) : null}
                    {call.score ? (
                      <Badge tone={call.score.failed ? "red" : "green"}>
                        {call.score.passed} pass · {call.score.failed} fail
                      </Badge>
                    ) : null}
                  </span>
                  <span className="line-clamp-2 text-ink-muted">
                    {call.headline ??
                      (call.wrapupStatus === "running"
                        ? "Writing the wrap-up…"
                        : "No wrap-up yet.")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="flex min-w-0 flex-col gap-6">
        {state.call && !busy ? (
          <>
            <WrapupView
              call={state.call}
              onChanged={() => {
                void controller.refresh();
                void onChanged();
              }}
            />
            <Panel
              eyebrow="Transcript"
              title="What was said"
              bodyClassName="flex flex-col gap-3 p-4"
            >
              <SavedTranscript controller={controller} />
            </Panel>
          </>
        ) : (
          <Panel title="Pick a call">
            <p className="text-sm text-ink-muted">
              {busy
                ? "A call is live. Its wrap-up appears here when it ends."
                : "Its wrap-up and transcript open here."}
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function SavedTranscript({ controller }: { controller: CallController }) {
  const { state } = controller;
  return (
    <>
      {state.items.map((item) =>
        item.kind === "note" ? (
          <p
            key={item.id}
            className="font-mono text-xs text-ink-muted uppercase"
          >
            {item.text}
          </p>
        ) : item.kind === "tool" ? (
          <p key={item.id} className="text-sm">
            <Badge
              tone={
                item.refusal.length ? "amber" : item.ok ? "blue" : "neutral"
              }
            >
              {item.refusal.length ? "refused" : "tool"} · {item.name}
            </Badge>{" "}
            {item.summary}
            {item.refusal.map((hit) => (
              <span key={hit.ruleId} className="font-mono text-xs">
                {" "}
                [{hit.ruleId} v{hit.version}]
              </span>
            ))}
          </p>
        ) : (
          <p key={item.id} className="text-sm">
            <strong>{item.kind === "agent" ? "Agent" : "Caller"}:</strong>{" "}
            {item.text}
          </p>
        ),
      )}
    </>
  );
}

// Rules -------------------------------------------------------------------------------------

function ParamField({
  name,
  spec,
  value,
  onChange,
}: {
  name: string;
  spec: ParamSpec;
  value: ParamValue;
  onChange: (value: ParamValue) => void;
}) {
  const id = `swb-param-${name}`;
  if (spec.kind === "boolean")
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {spec.label}
      </label>
    );
  if (spec.kind === "multi") {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="eyebrow">{spec.label}</legend>
        {spec.options.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={chosen.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...chosen, option.value]
                    : chosen.filter((item) => item !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
      <span className="eyebrow">
        {spec.label}
        {spec.kind === "number" && spec.unit ? ` (${spec.unit})` : ""}
      </span>
      {spec.kind === "number" ? (
        <input
          id={id}
          type="number"
          className={inputClass}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          value={Number(value)}
          onChange={(event) => onChange(Number(event.target.value))}
          data-testid={id}
        />
      ) : spec.kind === "phrases" ? (
        <>
          <textarea
            id={id}
            className={cx(inputClass, "font-mono text-xs")}
            rows={3}
            value={(Array.isArray(value) ? value : []).join("\n")}
            onChange={(event) =>
              onChange(
                event.target.value.split("\n").filter((line) => line.trim()),
              )
            }
          />
          <span className="text-xs text-ink-muted">{spec.help}</span>
        </>
      ) : (
        <textarea
          id={id}
          className={inputClass}
          rows={2}
          maxLength={spec.max}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function RuleCard({
  rule,
  versions,
  onChanged,
}: {
  rule: ResolvedRule;
  versions: number;
  onChanged: () => Promise<void>;
}) {
  const definition = RULES.find((item) => item.id === rule.id);
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [params, setParams] = useState(rule.params);
  useEffect(() => {
    setEnabled(rule.enabled);
    setParams(rule.params);
  }, [rule]);
  const save = useWrite(async () => {
    const result = await saveRuleAction({ ruleId: rule.id, enabled, params });
    if (!result.ok) throw new Error(result.error);
    await onChanged();
    return result.version;
  });
  const restore = useWrite(async () => {
    const result = await restoreRuleAction(rule.id);
    if (!result.ok) throw new Error(result.error);
    await onChanged();
    return result.version;
  });
  if (!definition) return null;
  return (
    <li
      className="outline-box rounded-sm bg-paper shadow-hard-sm"
      data-testid={`swb-rule-${rule.id}`}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-1 p-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex flex-wrap items-center gap-2">
          <strong className="font-serif text-base">{definition.title}</strong>
          <Badge tone="ink" className="font-mono">
            {rule.id} v{rule.version}
          </Badge>
          {rule.enabled ? null : <Badge tone="red">off</Badge>}
        </span>
        <span className="text-sm text-ink-muted">{renderRule(rule)}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t-2 border-ink p-3">
          <p className="text-xs text-ink-muted">
            <strong className="text-ink">Why:</strong> {definition.why}{" "}
            <strong className="text-ink">Checked at:</strong>{" "}
            {definition.checkedAt}.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            This Rule is on
          </label>
          {Object.entries(definition.params).map(([name, spec]) => (
            <ParamField
              key={name}
              name={name}
              spec={spec}
              value={params[name]}
              onChange={(value) =>
                setParams((current) => ({ ...current, [name]: value }))
              }
            />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              pending={save.pending}
              pendingLabel="Saving…"
              onClick={() => void save.run()}
              data-testid={`swb-save-${rule.id}`}
            >
              Save as v{Math.max(rule.version, 1) + 1}
            </Button>
            {rule.version > 1 ? (
              <Button
                size="sm"
                pending={restore.pending}
                pendingLabel="Restoring…"
                onClick={() => void restore.run()}
              >
                Back to the Default
              </Button>
            ) : null}
            <span className="text-xs text-ink-muted">
              {versions} saved Version{versions === 1 ? "" : "s"}. The next call
              starts under it.
            </span>
          </div>
          {save.result ? (
            <p className="text-sm text-ivy" data-testid="swb-rule-saved">
              Saved as v{save.result}.
            </p>
          ) : null}
          {save.error || restore.error ? (
            <ErrorNote>{save.error ?? restore.error}</ErrorNote>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function RulesPanel({
  view,
  onChanged,
}: {
  view: FirstView | null;
  onChanged: () => Promise<void>;
}) {
  if (!view) return <Loading />;
  return (
    <>
      <Panel
        eyebrow="Data, per visitor, versioned"
        title="Rules the voice cannot break"
      >
        <p className="text-sm text-ink-muted">
          The Agent is told these Rules, but telling is a courtesy. Each one is
          checked by code when a tool is called: the Back office refuses,
          whatever the caller says they are and however the model was talked
          round. Edit one, call again, and hear the line behave differently.
        </p>
      </Panel>
      <ul className="grid gap-4 lg:grid-cols-2">
        {view.rules.rulebook.map((rule) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            versions={
              view.rules.versions.filter((row) => row.ruleId === rule.id).length
            }
            onChanged={onChanged}
          />
        ))}
      </ul>
    </>
  );
}

// Under the hood ----------------------------------------------------------------------------

export function HoodPanel({ controller }: { controller: CallController }) {
  const { state } = controller;
  const [trail, setTrail] = useState<CallEvent[] | null>(null);
  const phase = state.phase;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when a Call starts or ends.
  useEffect(() => {
    void api
      .trail()
      .then((result) => setTrail(result.events))
      .catch(() => setTrail([]));
  }, [phase]);
  const call = state.call;
  const turns = useMemo(
    () => state.items.filter((item) => item.kind === "agent" && !item.partial),
    [state.items],
  );
  const held = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of state.items)
      if (item.kind === "tool")
        for (const hit of item.refusal) {
          const key = `${hit.ruleId} v${hit.version}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    return [...counts.entries()];
  }, [state.items]);
  const voice = call?.line === "voice";
  const usage = state.usage;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel
        eyebrow="How it runs"
        title="One Agent, one way in"
        className="lg:col-span-2"
      >
        <ol className="grid gap-3 text-sm text-ink-muted sm:grid-cols-2 lg:grid-cols-4">
          <li>
            <strong className="text-ink">1. Speech to speech.</strong> Your
            browser holds one realtime session with the model through Vercel AI
            Gateway, opened with a one-minute secret the server minted. No
            transcription step sits between you and the answer.
          </li>
          <li>
            <strong className="text-ink">
              2. Tools go through the server.
            </strong>{" "}
            When the model asks for a tool, the call is passed to the Back
            office: the same function behind the MCP server, the text line and
            an outside client.
          </li>
          <li>
            <strong className="text-ink">3. Rules at the tool boundary.</strong>{" "}
            Code checks identity, limits, Disclosures (against the transcript)
            and the clock before anything changes. Only code refuses.
          </li>
          <li>
            <strong className="text-ink">4. A Workflow per call.</strong> It is
            the server&rsquo;s clock (it cuts an overrunning call off) and
            writes the wrap-up after.
          </li>
        </ol>
      </Panel>
      <Panel eyebrow="This call" title="Model, cost and Rules">
        {call ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-muted">Line</dt>
            <dd>{call.line}</dd>
            <dt className="text-ink-muted">Model</dt>
            <dd className="font-mono text-xs">{call.model}</dd>
            <dt className="text-ink-muted">Cost so far</dt>
            <dd>
              {usd(state.costUsd)} of {usd(LIMITS.usdPerCall)}
            </dd>
            {voice ? (
              <>
                <dt className="text-ink-muted">Audio tokens in / out</dt>
                <dd>
                  {usage.inputAudioTokens ?? 0} / {usage.outputAudioTokens ?? 0}
                </dd>
                <dt className="text-ink-muted">Text tokens in / out</dt>
                <dd>
                  {usage.inputTextTokens ?? 0} / {usage.outputTextTokens ?? 0}
                </dd>
                <dt className="text-ink-muted">Cached input</dt>
                <dd>{usage.cachedInputTokens ?? 0}</dd>
              </>
            ) : null}
            <dt className="text-ink-muted">Rules that held</dt>
            <dd>
              {held.length === 0
                ? "none yet"
                : held.map(([rule, times]) => (
                    <Badge key={rule} tone="amber" className="mr-1 font-mono">
                      {rule} × {times}
                    </Badge>
                  ))}
            </dd>
            <dt className="text-ink-muted">Rulebook</dt>
            <dd className="font-mono text-xs">
              {call.rulebook
                .filter((rule) => rule.enabled)
                .map((rule) => `${rule.id}@v${rule.version}`)
                .join(", ")}
            </dd>
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">
            Start or open a call to see what ran.
          </p>
        )}
      </Panel>
      <Panel
        eyebrow="Per Turn"
        title={voice ? "Time to first audio" : "Time to first word"}
        bodyClassName=""
      >
        {turns.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">No Agent Turns yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="font-mono text-[0.65rem] tracking-wider text-ink-muted uppercase">
              <tr>
                <th className="p-2">Turn</th>
                <th className="p-2">{voice ? "First audio" : "First word"}</th>
                {voice ? <th className="p-2">+ turn detection</th> : null}
                <th className="p-2">In tools</th>
              </tr>
            </thead>
            <tbody>
              {turns.map((item, index) =>
                item.kind === "agent" ? (
                  <tr key={item.id} className="border-t-2 border-ink/10">
                    <td className="max-w-40 truncate p-2">
                      {index + 1}. {item.text}
                    </td>
                    <td className="p-2 font-mono">
                      {item.latency ? `${item.latency.firstAudioMs} ms` : "–"}
                    </td>
                    {voice ? (
                      <td className="p-2 font-mono">
                        {item.latency
                          ? `${item.latency.firstAudioMs + VAD_SILENCE_MS} ms`
                          : "–"}
                      </td>
                    ) : null}
                    <td className="p-2 font-mono">
                      {item.latency?.toolMs ? `${item.latency.toolMs} ms` : "–"}
                    </td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        )}
        {voice ? (
          <p className="border-t-2 border-ink/10 p-3 text-xs text-ink-muted">
            Measured in your browser from the moment turn detection called your
            Turn over to the first audio back. Turn detection itself waits{" "}
            {VAD_SILENCE_MS} ms of silence first, which you also feel; the
            second column adds it.
          </p>
        ) : null}
      </Panel>
      <Panel eyebrow="Live" title="Session event stream" bodyClassName="">
        {state.log.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">
            The realtime session&rsquo;s events appear here during a voice call:
            turn detection, first audio, tool calls, Barge-ins.
          </p>
        ) : (
          <ol
            className="max-h-96 overflow-y-auto p-3 font-mono text-xs"
            data-testid="swb-log"
          >
            {state.log.map((entry, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log.
              <li key={index} className="flex gap-2">
                <span className="w-14 shrink-0 text-right text-ink-muted">
                  {(entry.ms / 1000).toFixed(2)}s
                </span>
                <span className="font-bold">{entry.type}</span>
                <span className="truncate text-ink-muted">{entry.note}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <Panel eyebrow="Append-only" title="Audit trail" bodyClassName="">
        {trail === null ? (
          <p className="p-4 text-sm text-ink-muted">Loading…</p>
        ) : trail.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <ol
            className="max-h-96 overflow-y-auto text-xs"
            data-testid="swb-trail"
          >
            {trail.map((event) => (
              <li
                key={event.id}
                className="flex gap-2 border-b border-ink/10 px-3 py-1.5"
              >
                <span className="w-24 shrink-0 text-ink-muted">
                  {when(event.at)}
                </span>
                <span className="w-16 shrink-0 font-mono">{event.actor}</span>
                <span className="font-mono font-bold">{event.type}</span>
                <span className="truncate text-ink-muted">
                  {event.type === "tool.result"
                    ? event.data.summary
                    : event.type === "turn.caller" ||
                        event.type === "turn.agent"
                      ? event.data.text
                      : event.type === "rule.saved"
                        ? `${event.data.ruleId} v${event.data.version}`
                        : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

// Connect -----------------------------------------------------------------------------------

export function ConnectPanel() {
  const mint = useWrite(async () => {
    const result = await mintMcpTokenAction();
    if (!result.ok) throw new Error(result.error);
    return result;
  });
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${SWITCHBOARD_MCP_PATH}`;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel
        eyebrow="MCP"
        title="Connect a client"
        bodyClassName="flex flex-col gap-3 p-4"
      >
        <p className="text-sm text-ink-muted">
          The Back office and the line itself are one MCP server. An outside
          client such as Claude can play the caller (<code>start_call</code>,{" "}
          <code>caller_says</code>, <code>end_call</code>) or be the agent (the
          Back office tools, with <code>record_turn</code>). It acts as you,
          under the same Rules, caps and trail.
        </p>
        <p className="font-mono text-xs break-all" data-testid="swb-mcp-url">
          {url}
        </p>
        <div>
          <Button
            variant="primary"
            pending={mint.pending}
            pendingLabel="Minting…"
            onClick={() => void mint.run()}
            data-testid="swb-mint"
          >
            Mint a token
          </Button>
        </div>
        {mint.error ? <ErrorNote>{mint.error}</ErrorNote> : null}
        {mint.result ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              Shown once. It expires {when(mint.result.expiresAt)}.
            </p>
            <pre
              className="outline-box overflow-x-auto rounded-sm bg-ink p-3 font-mono text-xs text-paper"
              data-testid="swb-token"
            >
              {`claude mcp add --transport http switchboard ${url} \\\n  --header "Authorization: Bearer ${mint.result.token}"`}
            </pre>
          </div>
        ) : null}
      </Panel>
      <Panel eyebrow="Tools" title="What a client can do">
        <ul className="flex flex-col gap-1.5 text-sm text-ink-muted">
          <li>
            <strong className="text-ink">The line:</strong> start_call,
            caller_says, record_turn, end_call, get_call, list_calls
          </li>
          <li>
            <strong className="text-ink">The Back office:</strong>{" "}
            get_disruptions, find_booking, verify_identity, rebooking_options,
            rebook, issue_refund, issue_voucher, file_lost_property,
            book_assistance, schedule_callback, hand_off, read_policy
          </li>
          <li>
            <strong className="text-ink">The Owner&rsquo;s desk:</strong>{" "}
            list_records, reset_back_office, list_rules, save_rule
          </li>
        </ul>
      </Panel>
    </div>
  );
}
