"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenAction } from "../domain/actions";
import type { HandInput, TaskCard } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import type { SampleTask } from "../domain/task";
import { GEOMETRY, type LegacyState, SCREEN_TITLES } from "../legacy/types";
import { submitHandRun } from "../server/actions";
import { clock, errorsLabel } from "./format";
import { actionOfKey, clickAction, releasesFocus } from "./hand-keys";
import { type HandKit, loadHandKit } from "./hand-kit";
import { Bezel, useWidth } from "./screen";
import { fitScale } from "./scrub";
import {
  Button,
  ConfirmDialog,
  ErrorNote,
  friendly,
  Panel,
  Spinner,
  Tag,
  useNow,
  useWrite,
} from "./ui";

/** The longest attempt the server replays (`handInputSchema.at`). */
const MAX_MS = 3_600_000;

type Session = { state: LegacyState; startedAt: number; full: boolean };

/**
 * "Take the keyboard": the same HARBOURMASTER runs here in the browser, and
 * the visitor keys the Task by hand. Every key and click is recorded as an
 * Action with its time; "Finish and check" sends them, the server replays
 * them in the same machine and runs the same checks.
 */
export function HandMode({
  task,
  onFinished,
  onExit,
}: {
  task: TaskCard;
  /** The attempt was filed as a Run. */
  onFinished: (runId: string) => void;
  onExit: () => void;
}) {
  const [kit, setKit] = useState<HandKit | null>(null);
  const [sample, setSample] = useState<SampleTask | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [focused, setFocused] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What was keyed, in order. A ref: it never renders, and may hold thousands. */
  const inputs = useRef<HandInput[]>([]);
  const lastEscape = useRef<number | null>(null);
  const terminal = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLDivElement>(null);
  const scale = fitScale(useWidth(glass), GEOMETRY.width);
  const now = useNow(session !== null);

  const boot = useCallback((with_: HandKit, of: SampleTask) => {
    const at = Date.now();
    inputs.current = [];
    lastEscape.current = null;
    setError(null);
    setSession({
      state: with_.boot(of.fixture, at),
      startedAt: at,
      full: false,
    });
  }, []);

  useEffect(() => {
    let current = true;
    loadHandKit().then(
      (loaded) => {
        if (!current) return;
        const found = loaded.sampleTask(task.id);
        if (!found) {
          setLoadError("This Task cannot be keyed by hand.");
          return;
        }
        setKit(loaded);
        setSample(found);
        boot(loaded, found);
      },
      (caught: unknown) => {
        if (current)
          setLoadError(friendly(caught, "HARBOURMASTER could not load."));
      },
    );
    return () => {
      current = false;
    };
  }, [task.id, boot]);

  /** The session as of the last key, so two keys in one frame both land. */
  const live = useRef<Session | null>(null);
  live.current = session;

  /** Records one Action and applies it to the machine, at the same instant. */
  const apply = (action: ScreenAction) => {
    const current = live.current;
    if (!kit || !current || current.full) return;
    const at = Date.now();
    const elapsed = at - current.startedAt;
    let next: Session;
    // The log is what the server replays: past its cap nothing more is keyed here either.
    if (inputs.current.length >= LIMITS.handInputs || elapsed > MAX_MS)
      next = { ...current, full: true };
    else {
      inputs.current.push({ at: Math.max(0, elapsed), action });
      let state = current.state;
      for (const input of kit.inputsOf(action))
        state = kit.step(state, input, at);
      next = { ...current, state };
    }
    live.current = next;
    setSession(next);
  };

  const submit = useWrite(async () => {
    if (!session) return;
    setError(null);
    try {
      const result = await submitHandRun({
        taskId: task.id,
        inputs: inputs.current,
        elapsedMs: Math.min(MAX_MS, Date.now() - session.startedAt),
      });
      if ("error" in result) setError(result.error);
      else onFinished(result.runId);
    } catch (caught) {
      setError(friendly(caught, "The attempt could not be checked."));
    }
  });

  if (loadError)
    return (
      <Panel eyebrow="Take the keyboard" title={task.title}>
        <ErrorNote>{loadError}</ErrorNote>
        <Button className="mt-3" onClick={onExit}>
          Back to the recorded Run
        </Button>
      </Panel>
    );

  const screen =
    kit && session ? kit.render(session.state, now || session.startedAt) : null;
  const elapsed = session && now > 0 ? now - session.startedAt : 0;
  const locked = session?.full === true || submit.pending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-mono text-lg font-bold uppercase">{task.title}</h2>
        <Tag tone="blue">you have the keyboard</Tag>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-3">
          {kit ? <style>{kit.terminalCss}</style> : null}
          <Bezel
            plate="HARBOURMASTER · Port Authority of Meridia"
            lamp={focused ? "Keyboard on" : "Click the glass to key"}
            lampTone={focused ? "live" : "idle"}
            focused={focused}
            glass={
              <div ref={glass} className="absolute inset-0">
                {screen && kit ? (
                  <div
                    ref={terminal}
                    role="application"
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: the terminal must take focus to be keyed
                    tabIndex={0}
                    aria-label={`HARBOURMASTER terminal, Screen ${screen.code}, ${SCREEN_TITLES[screen.code]}. Press Escape twice to leave it.`}
                    aria-describedby="hand-help"
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={(event) => {
                      const at = Date.now();
                      if (releasesFocus(event, lastEscape.current, at)) {
                        event.preventDefault();
                        lastEscape.current = null;
                        event.currentTarget.blur();
                        return;
                      }
                      lastEscape.current = event.key === "Escape" ? at : null;
                      const action = actionOfKey(event);
                      if (!action) return;
                      // Tab, the function keys, the arrows and Backspace are HARBOURMASTER's here, not the browser's.
                      event.preventDefault();
                      if (!locked) apply(action);
                    }}
                    onMouseDown={(event) => {
                      const action = clickAction(
                        event.clientX,
                        event.clientY,
                        event.currentTarget.getBoundingClientRect(),
                      );
                      if (action && !locked) apply(action);
                    }}
                    className="absolute top-0 left-0 origin-top-left cursor-text outline-none"
                    style={{
                      width: GEOMETRY.width,
                      height: GEOMETRY.height,
                      transform: `scale(${scale || 1})`,
                      visibility: scale > 0 ? "visible" : "hidden",
                    }}
                  >
                    <div
                      className="hm-term"
                      // The markup is built by our own renderer (legacy/terminal.ts) from the
                      // machine's upper-cased terminal cells, escaped there: no visitor HTML reaches it.
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: see above
                      dangerouslySetInnerHTML={{
                        __html: kit.screenHtml(screen),
                      }}
                    />
                  </div>
                ) : (
                  <div className="grid size-full place-items-center gap-2 font-mono text-sm text-[#7dffb0]/80">
                    <span className="flex items-center gap-2">
                      <Spinner /> Loading HARBOURMASTER…
                    </span>
                  </div>
                )}
              </div>
            }
          >
            <dl className="mt-2 grid grid-cols-3 gap-x-3 font-mono text-[0.7rem]">
              <div>
                <dt className="text-[0.58rem] tracking-[0.1em] text-ink-muted uppercase">
                  Your time
                </dt>
                <dd className="text-base font-bold tabular-nums">
                  {clock(elapsed)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.58rem] tracking-[0.1em] text-ink-muted uppercase">
                  HARBOURMASTER
                </dt>
                <dd className="text-base font-bold tabular-nums">
                  {errorsLabel(session?.state.errors ?? 0)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.58rem] tracking-[0.1em] text-ink-muted uppercase">
                  Keyed
                </dt>
                <dd className="text-base font-bold tabular-nums">
                  {session?.state.inputs ?? 0}
                </dd>
              </div>
            </dl>
          </Bezel>
          <p id="hand-help" className="text-sm text-ink-muted">
            Click the glass, then key as a clerk would: Tab moves between
            fields, the function keys are on the bottom line of each Screen.
            While the terminal has the keyboard it takes Tab and the function
            keys. Press Escape twice to leave it.
          </p>
          {session?.full ? (
            <p
              role="alert"
              className="border-2 border-ink bg-brass/25 px-3 py-2 text-sm"
            >
              The log is full ({LIMITS.handInputs} inputs or one hour), so
              nothing more is recorded or keyed. Finish and check, or restart.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              disabled={!session}
              pending={submit.pending}
              pendingLabel="Checking…"
              onClick={() => void submit.run()}
            >
              Finish and check
            </Button>
            <Button
              disabled={!session || submit.pending}
              onClick={() => setConfirming(true)}
            >
              Restart
            </Button>
            <Button variant="ghost" disabled={submit.pending} onClick={onExit}>
              Give the keyboard back
            </Button>
          </div>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel eyebrow="The Task" title={task.title}>
            <p className="text-sm whitespace-pre-wrap">
              {sample?.brief ?? task.brief}
            </p>
          </Panel>
          {sample?.manifest ? (
            <Panel
              eyebrow="The Manifest: key every row"
              title={sample.manifest.name}
              bodyClassName=""
            >
              <pre className="op-scroll max-h-96 overflow-auto p-3 font-mono text-[0.68rem] leading-relaxed">
                {sample.manifest.text}
              </pre>
            </Panel>
          ) : null}
          <p className="text-xs text-ink-muted">
            Nobody approves a person at the keyboard. The same code checks your
            Books afterwards, and puts your time and errors beside the
            Operator's.
          </p>
        </div>
      </div>
      {confirming && kit && sample ? (
        <ConfirmDialog
          title="Restart the Task?"
          confirm="Restart"
          pendingLabel="Restarting…"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            boot(kit, sample);
            return null;
          }}
        >
          Everything you keyed is thrown away, the Books go back to where the
          Task starts, and your time starts again.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
