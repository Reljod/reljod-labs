"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DemoBar } from "@/components/demo/demo-bar";
import {
  Badge,
  Button,
  cx,
  ErrorNote,
  inputClass,
  Panel,
  segmentClass,
  segmentsClass,
} from "@/features/harness/components/ui";
import type { FirstView } from "../domain/api";
import type { Scenario } from "../domain/contract";
import { LANGUAGE_LABEL } from "../domain/hearing";
import { LIMITS } from "../domain/limits";
import { DEFAULT_REALTIME_MODEL, REALTIME_MODELS, usd } from "../domain/models";
import { SAMPLE_CALLERS } from "../domain/samples";
import { TOOL_DOING } from "../domain/tools";
import type { Item } from "../domain/transcript";
import { type Booking, ISSUES, type IssueId } from "../domain/world";
import { api } from "./api";
import {
  BackOfficePanel,
  CallsPanel,
  ConnectPanel,
  HoodPanel,
  RulesPanel,
  WrapupView,
} from "./panels";
import { type CallController, useCall } from "./use-call";

const TABS = [
  { id: "call", label: "Call" },
  { id: "backoffice", label: "Back office" },
  { id: "calls", label: "Calls" },
  { id: "rules", label: "Rules" },
  { id: "hood", label: "Under the hood" },
  { id: "connect", label: "Connect a client" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Switchboard: the phone line of Meridia Rail, answered by one voice Agent. */
export function Switchboard({ initial }: { initial: FirstView | null }) {
  const [tab, setTab] = useState<TabId>("call");
  const [view, setView] = useState<FirstView | null>(initial);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setView(await api.state());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load.");
    }
  }, []);
  useEffect(() => {
    if (!initial) void reload();
  }, [initial, reload]);

  const controller = useCall(reload);
  const { state } = controller;
  const liveNow = state.phase === "live" || state.phase === "connecting";

  return (
    <div className="flex min-h-dvh flex-col bg-marble text-ink">
      <DemoBar
        slug="switchboard"
        name="Switchboard"
        current={tab}
        panelsId="swb"
        rowFrom="xl"
        badge="Synthetic data"
        tabs={TABS.map((item) => ({
          id: item.id,
          label: item.label,
          testId: `swb-tab-${item.id}`,
          onSelect: () => setTab(item.id),
        }))}
      >
        {liveNow ? (
          <Badge tone="red" dot>
            On a call
          </Badge>
        ) : null}
      </DemoBar>
      <main
        id={`swb-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`swb-tab-${tab}`}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
      >
        {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}
        {tab === "call" ? (
          <CallTab controller={controller} view={view} />
        ) : null}
        {tab === "backoffice" ? (
          <BackOfficePanel
            view={view}
            callId={state.call?.id ?? null}
            onChanged={reload}
          />
        ) : null}
        {tab === "calls" ? (
          <CallsPanel
            view={view}
            controller={controller}
            onOpen={(id) => void controller.open(id)}
            onChanged={reload}
          />
        ) : null}
        {tab === "rules" ? <RulesPanel view={view} onChanged={reload} /> : null}
        {tab === "hood" ? <HoodPanel controller={controller} /> : null}
        {tab === "connect" ? <ConnectPanel /> : null}
      </main>
    </div>
  );
}

// The Call ----------------------------------------------------------------------------------

function CallTab({
  controller,
  view,
}: {
  controller: CallController;
  view: FirstView | null;
}) {
  const { state } = controller;
  const [model, setModel] = useState(DEFAULT_REALTIME_MODEL);
  const [bookingRef, setBookingRef] = useState("");
  const [issue, setIssue] = useState<IssueId>("delay");
  const bookings = (view?.records ?? []).filter(
    (record) => record.kind === "booking",
  );
  const idle = state.phase === "idle" || state.phase === "done";
  const own = (): Scenario =>
    bookingRef ? { kind: "own", bookingRef, issue } : { kind: "open" };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Stage controller={controller} />
        {idle ? (
          <Panel
            eyebrow="Start a call"
            title="Press one button and talk"
            bodyClassName="flex flex-col gap-4 p-4"
          >
            <p className="text-sm text-ink-muted">
              You are calling <strong className="text-ink">Meridia Rail</strong>
              , a railway that does not exist. The Agent answers by voice in
              well under a second; talk over it and it stops. Your browser asks
              for the microphone only when you press Call.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Your booking (optional)</span>
                <select
                  className={inputClass}
                  value={bookingRef}
                  onChange={(event) => setBookingRef(event.target.value)}
                  data-testid="swb-booking"
                >
                  <option value="">No booking: just call</option>
                  {bookings.map((record) => {
                    const data = record.data as Booking;
                    return (
                      <option key={record.ref} value={record.ref}>
                        {record.ref} · {data.passenger.name} · {data.serviceId}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="eyebrow">What went wrong</span>
                <select
                  className={inputClass}
                  value={issue}
                  disabled={!bookingRef}
                  onChange={(event) => setIssue(event.target.value as IssueId)}
                >
                  {ISSUES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {bookingRef ? (
              <OwnHint view={view} bookingRef={bookingRef} />
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="eyebrow">Voice model</span>
              <div className={segmentsClass}>
                {REALTIME_MODELS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={item.note}
                    aria-pressed={model === item.id}
                    className={segmentClass(model === item.id)}
                    onClick={() => setModel(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                data-testid="swb-start-voice"
                onClick={() =>
                  void controller.startVoice({
                    model,
                    scenario: own(),
                    mic: true,
                  })
                }
              >
                Call with your voice
              </Button>
              <Button
                data-testid="swb-start-text"
                onClick={() => void controller.startText(own())}
              >
                Call by typing
              </Button>
              <span className="text-xs text-ink-muted">
                Up to {LIMITS.callSeconds / 60} minutes and{" "}
                {usd(LIMITS.usdPerCall)} a call, {LIMITS.callsPerHour} calls an
                hour.
              </span>
            </div>
            {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
          </Panel>
        ) : null}
        {idle ? (
          <Panel
            eyebrow="Or listen first"
            title="Sample callers"
            bodyClassName="grid gap-3 p-4 sm:grid-cols-2"
          >
            {SAMPLE_CALLERS.map((caller) => (
              <button
                key={caller.id}
                type="button"
                data-testid={`swb-sample-${caller.id}`}
                onClick={() =>
                  void controller.startVoice({
                    model,
                    scenario: { kind: "sample", sampleId: caller.id },
                    mic: false,
                  })
                }
                className="outline-box press flex flex-col gap-1.5 rounded-sm bg-paper p-3 text-left"
              >
                <span className="font-serif text-base font-bold">
                  {caller.name}
                </span>
                <span className="text-sm text-ink-muted">{caller.title}</span>
                <span className="flex flex-wrap gap-1">
                  {caller.shows.map((show) => (
                    <Badge key={show}>{show}</Badge>
                  ))}
                </span>
              </button>
            ))}
            <p className="text-xs text-ink-muted sm:col-span-2">
              The callers&rsquo; voices are synthetic speech made ahead of time,
              played into a real session. Only the caller is scripted: the Agent
              answers live, so no two runs match.
            </p>
          </Panel>
        ) : null}
        {state.phase === "done" && state.call ? (
          <WrapupView
            call={state.call}
            onChanged={() => void controller.refresh()}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <Transcript controller={controller} />
        <Panel eyebrow="Why it matters" title="Where this fits in a bank">
          <ul className="flex flex-col gap-2 text-sm text-ink-muted">
            <li>
              <strong className="text-ink">A card lost at 2am.</strong> The line
              answers at once, verifies the caller, blocks the card through a
              tool, and never reads out a detail before the identity check
              passes.
            </li>
            <li>
              <strong className="text-ink">Balance and dispute lines.</strong>{" "}
              The same Rules: limits on what the Agent may refund, a person for
              anything above them.
            </li>
            <li>
              <strong className="text-ink">Collections.</strong> A compliance
              script is a Disclosure Rule: the tool is refused until the words
              were said, and the scorecard proves it for every call.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function OwnHint({
  view,
  bookingRef,
}: {
  view: FirstView | null;
  bookingRef: string;
}) {
  const record = view?.records.find(
    (item) => item.kind === "booking" && item.ref === bookingRef,
  );
  if (!record) return null;
  const data = record.data as Booking;
  return (
    <p className="outline-box rounded-sm bg-morning-haze p-3 text-sm">
      You are <strong>{data.passenger.name}</strong>. The Agent will ask for
      your booking reference <strong className="font-mono">{record.ref}</strong>{" "}
      and your postcode{" "}
      <strong className="font-mono">{data.passenger.postcode}</strong> (or the
      card&rsquo;s last four digits,{" "}
      <strong className="font-mono">{data.passenger.cardLast4}</strong>). Try
      giving the wrong one.
    </p>
  );
}

/** The call surface: the orb for both sides, the clock, the hang-up. */
function Stage({ controller }: { controller: CallController }) {
  const { state } = controller;
  const callerRing = useRef<HTMLDivElement>(null);
  const agentRing = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  const live = state.phase === "live";

  useEffect(() => {
    if (!live) return;
    let frame = 0;
    const tick = () => {
      const levels = controller.levels();
      if (callerRing.current)
        callerRing.current.style.transform = `scale(${1 + levels.caller * 0.55})`;
      if (agentRing.current)
        agentRing.current.style.transform = `scale(${1 + levels.agent * 0.55})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live, controller]);

  useEffect(() => {
    if (!live || !state.call) return setLeft(null);
    const deadline = Date.parse(state.call.deadlineAt);
    const tick = () =>
      setLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [live, state.call]);

  const voice = state.call?.line === "voice";
  const status =
    state.phase === "connecting"
      ? "Connecting…"
      : state.phase === "wrapping"
        ? "Call ended. Writing the wrap-up…"
        : state.phase === "done"
          ? "Call ended"
          : state.phase === "idle"
            ? "The line is free"
            : state.toolBusy
              ? `${(TOOL_DOING as Record<string, string>)[state.toolBusy] ?? "Using the Back office"}…`
              : state.speaking === "agent"
                ? "The Agent is speaking"
                : state.speaking === "caller"
                  ? "Listening"
                  : state.thinking
                    ? "The Agent is thinking…"
                    : "On the line";
  const lastWait = [...state.items]
    .reverse()
    .find((item) => item.kind === "agent" && item.latency);
  const waitMs =
    lastWait?.kind === "agent" ? lastWait.latency?.firstAudioMs : undefined;

  return (
    <section
      className="outline-box relative overflow-hidden rounded-sm bg-federal-blue text-paper shadow-hard-md"
      data-testid="swb-stage"
      data-phase={state.phase}
    >
      <div className="flex flex-col items-center gap-5 px-4 py-8 sm:py-10">
        <div className="flex items-center gap-8 sm:gap-14">
          <Orb
            label="Caller"
            ringRef={callerRing}
            active={state.speaking === "caller"}
            tone="bg-paper"
          />
          <div className="flex flex-col items-center gap-1">
            <span className="font-mono text-xs tracking-[0.2em] uppercase opacity-80">
              Meridia Rail
            </span>
            <span className="font-serif text-2xl font-bold tabular-nums sm:text-3xl">
              {left === null
                ? "0:00"
                : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
            </span>
            <span className="font-mono text-[0.65rem] tracking-widest uppercase opacity-70">
              {left === null ? "ready" : "left on this call"}
            </span>
          </div>
          <Orb
            label="Agent"
            ringRef={agentRing}
            active={state.speaking === "agent"}
            tone="bg-brass"
          />
        </div>
        <p
          className="min-h-6 text-center font-mono text-sm"
          aria-live="polite"
          data-testid="swb-status"
        >
          {status}
        </p>
        <AnimatePresence>
          {state.toolBusy ? (
            <motion.div
              key="tool"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="outline-box rounded-sm bg-brass px-3 py-1.5 font-mono text-xs font-bold text-ink"
            >
              TOOL · {state.toolBusy}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="flex flex-wrap items-center justify-center gap-2 font-mono text-[0.7rem]">
          {state.call ? (
            <Chip>
              {state.call.line === "voice" ? "voice line" : "text line"}
            </Chip>
          ) : null}
          {state.call ? <Chip>{state.call.model}</Chip> : null}
          {waitMs !== undefined ? (
            <Chip>
              {voice ? "first audio" : "first word"} {waitMs} ms
            </Chip>
          ) : null}
          {state.costUsd > 0 ? <Chip>{usd(state.costUsd)}</Chip> : null}
          {live && voice && state.mic === "refused" ? (
            <Chip>microphone refused: listen and type</Chip>
          ) : null}
        </div>
        {live || state.phase === "connecting" ? (
          <Button
            variant="danger"
            data-testid="swb-hangup"
            disabled={state.phase !== "live"}
            onClick={() => void controller.hangUp()}
          >
            Hang up
          </Button>
        ) : state.phase === "done" ? (
          <Button data-testid="swb-new-call" onClick={controller.reset}>
            New call
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-paper/60 px-2 py-0.5 tracking-wider uppercase">
      {children}
    </span>
  );
}

function Orb({
  label,
  ringRef,
  active,
  tone,
}: {
  label: string;
  ringRef: React.RefObject<HTMLDivElement | null>;
  active: boolean;
  tone: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative grid size-20 place-items-center sm:size-24">
        <div
          ref={ringRef}
          className={cx(
            "absolute inset-0 rounded-full border-2 border-paper/70 transition-transform duration-75",
            active ? "opacity-100" : "opacity-40",
          )}
        />
        <div
          className={cx(
            "size-12 rounded-full border-2 border-ink sm:size-14",
            tone,
            active ? "motion-safe:animate-pulse" : "",
          )}
        />
      </div>
      <span className="font-mono text-[0.65rem] tracking-[0.2em] uppercase">
        {label}
      </span>
    </div>
  );
}

/** The live transcript, with the box to type a Turn. */
function Transcript({ controller }: { controller: CallController }) {
  const { state } = controller;
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const count = state.items.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the transcript grows.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [count, state.items.at(-1)?.kind === "agent" ? state.items.at(-1) : null]);
  const live = state.phase === "live";
  const sample =
    state.call?.scenario.kind === "sample"
      ? SAMPLE_CALLERS.find(
          (caller) =>
            state.call?.scenario.kind === "sample" &&
            caller.id === state.call.scenario.sampleId,
        )
      : undefined;
  const send = () => {
    if (!text.trim() || state.thinking) return;
    void controller.say(text);
    setText("");
  };

  return (
    <Panel
      eyebrow="Transcript"
      title={sample ? `${sample.name} is calling` : "What is said"}
      bodyClassName="flex flex-col"
    >
      <div
        className="flex max-h-[32rem] min-h-56 flex-col gap-3 overflow-y-auto p-4"
        data-testid="swb-transcript"
      >
        {state.items.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {live
              ? "The Agent greets first."
              : "Nothing yet. Start a call, or play a sample caller."}
          </p>
        ) : null}
        {state.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            voice={state.call?.line === "voice"}
          />
        ))}
        {sample && state.sampleLine !== null ? (
          <p className="self-start font-mono text-xs text-ink-muted">
            {sample.name} is speaking…
          </p>
        ) : null}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 border-t-2 border-ink p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          className={inputClass}
          value={text}
          maxLength={LIMITS.turnChars}
          disabled={!live || Boolean(sample)}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            live
              ? sample
                ? "A sample caller is on the line"
                : "Type what you would say…"
              : "Start a call to type"
          }
          aria-label="Say something as the Caller"
          data-testid="swb-input"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!live || !text.trim() || Boolean(sample)}
          pending={state.thinking}
          pendingLabel="…"
          data-testid="swb-send"
        >
          Say
        </Button>
      </form>
    </Panel>
  );
}

export function ItemRow({ item, voice }: { item: Item; voice: boolean }) {
  if (item.kind === "note")
    return (
      <p
        className={cx(
          "self-center rounded-sm px-2 py-1 font-mono text-[0.7rem] uppercase tracking-wider",
          item.tone === "barge"
            ? "bg-seal-red text-paper"
            : "bg-ink/10 text-ink-muted",
        )}
        data-testid={item.tone === "barge" ? "swb-barge" : undefined}
      >
        {item.text}
      </p>
    );
  if (item.kind === "tool") {
    const refused = item.refusal.length > 0;
    return (
      <div
        className={cx(
          "outline-box rounded-sm p-2.5 text-sm shadow-hard-sm",
          refused ? "bg-brass/40" : item.ok ? "bg-morning-haze" : "bg-marble",
        )}
        data-testid={refused ? "swb-refusal" : "swb-tool"}
      >
        <p className="flex flex-wrap items-center gap-2 font-mono text-xs font-bold uppercase">
          <span>{refused ? "Refused" : item.ok ? "Tool" : "Tool failed"}</span>
          <span>{item.name}</span>
          <span className="font-normal text-ink-muted">{item.ms} ms</span>
        </p>
        <p className="mt-1">{item.summary}</p>
        {item.refusal.map((hit) => (
          <p key={`${hit.ruleId}${hit.message}`} className="mt-1 text-xs">
            <strong className="font-mono">
              {hit.ruleId} v{hit.version}
            </strong>{" "}
            held: {hit.message}
          </p>
        ))}
        {item.records.length > 0 ? (
          <p className="mt-1 flex flex-wrap gap-1">
            {item.records.map((record) => (
              <Badge key={record.ref} tone="green">
                {record.op === "create" ? "new" : "changed"} {record.ref}
              </Badge>
            ))}
          </p>
        ) : null}
      </div>
    );
  }
  const agent = item.kind === "agent";
  return (
    <div
      className={cx(
        "flex max-w-[88%] flex-col gap-1",
        agent ? "self-end items-end" : "self-start",
      )}
    >
      <p className="flex items-center gap-1.5 font-mono text-[0.65rem] tracking-wider text-ink-muted uppercase">
        <span>{agent ? "Agent" : "Caller"}</span>
        {item.language !== "und" ? (
          <Badge>{LANGUAGE_LABEL[item.language]}</Badge>
        ) : null}
        {agent && item.latency ? (
          <span title="From the end of the Caller's Turn to the Agent's first sound">
            {item.latency.firstAudioMs} ms
          </span>
        ) : null}
        {agent && item.interrupted ? <Badge tone="red">cut off</Badge> : null}
      </p>
      <p
        className={cx(
          "outline-box rounded-sm px-3 py-2 text-sm shadow-hard-sm",
          agent ? "bg-paper" : "bg-federal-blue text-paper",
          agent && item.partial ? "opacity-80" : "",
        )}
        data-testid={agent ? "swb-agent-turn" : "swb-caller-turn"}
      >
        {item.text}
        {agent && item.interrupted ? (
          <span className="text-seal-red"> —</span>
        ) : null}
        {!voice && agent && item.partial ? (
          <span className="animate-pulse"> ▍</span>
        ) : null}
      </p>
    </div>
  );
}
