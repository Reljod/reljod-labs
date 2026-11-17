"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Badge, Button, ConfirmDialog, cx, Dialog } from "../ui";
import { settlers } from "./actions";
import { DemoEngine, type EngineState, type Scenario } from "./engine";
import { SCENARIOS, scenarioById } from "./scenarios";
import { clearSaved, readSaved, type Saved, writeSaved } from "./storage";
import { useHost } from "./use-host";

/** How long a Beat runs before "Skip waiting" is offered. */
const SKIP_AFTER_MS = 4_000;

const noop = () => {};
const noSubscribe = () => noop;
const noState = () => null;

/**
 * Demo mode: the Scenario picker (a dialog, while `open`) and the guide bar
 * (docked while a Scenario runs, whether or not the picker is open). The
 * engine lives here, above the tabs, so a Beat survives a change of tab.
 * Beats act on the real app through `useHarness().controller()` only.
 */
export default function DemoMode({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const host = useHost();
  const [engine, setEngine] = useState<DemoEngine | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  // The hint is only an offer: it never opens the picker. It is shown once per
  // page load, and goes when it is dismissed, used, or the picker is opened.
  const [hintOpen, setHintOpen] = useState(true);
  const engineRef = useRef<DemoEngine | null>(null);
  engineRef.current = engine;

  // What a reload can resume. Read after mount: the server render has no storage.
  useEffect(() => {
    setSaved(readSaved());
  }, []);

  useEffect(() => () => engineRef.current?.cancel(), []);

  const start = useCallback(
    (scenario: Scenario, resume?: Saved) => {
      engineRef.current?.cancel();
      const next = new DemoEngine(
        {
          scenario,
          host,
          startIndex: resume?.index ?? 0,
          state: resume?.state,
          onSave: (state) =>
            writeSaved({
              scenarioId: state.scenarioId,
              index: state.index,
              state: state.state,
            }),
        },
        settlers,
      );
      writeSaved({
        scenarioId: scenario.id,
        index: resume?.index ?? 0,
        state: next.getState().state,
      });
      setEngine(next);
    },
    [host],
  );

  const leave = useCallback((forget: boolean) => {
    engineRef.current?.cancel();
    if (forget) {
      clearSaved();
      setSaved(null);
    } else {
      setSaved(readSaved());
    }
    setEngine(null);
  }, []);

  const state = useSyncExternalStore(
    engine?.subscribe ?? noSubscribe,
    engine ? engine.getState : noState,
    noState,
  );

  const resumable = saved ? scenarioById(saved.scenarioId) : null;
  const resumeAt =
    resumable && saved && saved.index < resumable.beats.length ? saved : null;

  return (
    <>
      {resumable && resumeAt && !engine && !open && hintOpen ? (
        <ResumeHint
          title={resumable.title}
          beat={resumeAt.index + 1}
          total={resumable.beats.length}
          onContinue={() => {
            setHintOpen(false);
            start(resumable, resumeAt);
          }}
          onDismiss={() => setHintOpen(false)}
        />
      ) : null}
      {open ? (
        <Picker
          running={engine ? engine.scenario : null}
          saved={saved}
          onClose={onClose}
          onStart={(scenario, resume) => {
            start(scenario, resume);
            onClose();
          }}
          onForget={() => {
            clearSaved();
            setSaved(null);
          }}
        />
      ) : null}
      {engine && state ? (
        <GuideBar
          engine={engine}
          state={state}
          onBack={() => leave(false)}
          onExit={() => leave(true)}
        />
      ) : null}
    </>
  );
}

// Picker --------------------------------------------------------------------------------

function Picker({
  running,
  saved,
  onClose,
  onStart,
  onForget,
}: {
  running: Scenario | null;
  saved: Saved | null;
  onClose: () => void;
  onStart: (scenario: Scenario, resume?: Saved) => void;
  onForget: () => void;
}) {
  const resumable = saved ? scenarioById(saved.scenarioId) : null;
  const resumeAt =
    resumable && saved && saved.index < resumable.beats.length ? saved : null;
  return (
    <Dialog
      title="Demo mode"
      wide
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {running ? "Back to the app" : "Close"}
        </Button>
      }
    >
      <p className="text-ink-muted">
        Pick a Scenario, then press <strong>Next</strong>. Each press does the
        next thing for you, in your own Workspace and with the live model: the
        same as if you had clicked it. Close this at any time and carry on by
        hand.
      </p>
      <p className="mt-2 text-xs text-ink-muted">
        Because the model is live, the Agent may answer differently each time.
        If it does not do what a Beat expects, the guide says so and offers a
        way on. Beats that start Runs count against the same hourly limits as
        any Run.
      </p>

      {running ? (
        <p className="mt-3 rounded-sm outline-box bg-morning-haze/50 px-3 py-2 text-sm">
          Running now: <strong>{running.title}</strong>. Close this to carry on,
          or pick another Scenario to start it instead.
        </p>
      ) : null}

      {resumeAt && resumable && !running ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm outline-box bg-morning-haze/50 px-3 py-2">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">Continue where you left off</span>
            <span className="block text-xs text-ink-muted">
              {resumable.title}, Beat {resumeAt.index + 1} of{" "}
              {resumable.beats.length}
            </span>
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => onStart(resumable, resumeAt)}
          >
            Continue
          </Button>
          <Button size="sm" variant="ghost" onClick={onForget}>
            Forget it
          </Button>
        </div>
      ) : null}

      <ul className="mt-4 space-y-3">
        {SCENARIOS.map((scenario) => (
          <li key={scenario.id} className="rounded-sm outline-box bg-paper p-3">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-mono text-sm font-bold uppercase">
                  {scenario.title}
                </h3>
                <p className="mt-1 text-sm text-ink-muted">
                  {scenario.summary}
                </p>
                <p className="mt-2 text-xs text-ink-muted">
                  {scenario.beats.length} Beats · about {scenario.minutes}{" "}
                  minutes · as {scenario.asRole}
                </p>
                <ul
                  className="mt-2 flex flex-wrap gap-1"
                  aria-label="Features it touches"
                >
                  {scenario.features.map((feature) => (
                    <li key={feature}>
                      <Badge tone="blue">{feature}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => onStart(scenario)}
                aria-label={`Start: ${scenario.title}`}
              >
                Start
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

// Guide bar -------------------------------------------------------------------------------

type Edge = "bottom" | "top";

function GuideBar({
  engine,
  state,
  onBack,
  onExit,
}: {
  engine: DemoEngine;
  state: EngineState;
  onBack: () => void;
  onExit: () => void;
}) {
  const scenario = engine.scenario;
  const beat = engine.beat;
  const total = scenario.beats.length;
  const running = state.status === "running";
  const stuck = state.status === "drifted" || state.status === "failed";
  const [edge, setEdge] = useState<Edge>("bottom");
  const [confirm, setConfirm] = useState<"back" | "exit" | null>(null);
  // A visitor may fold the guide to a thin strip; it opens by itself when a Beat gets stuck.
  const [folded, setFolded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick while a Beat runs, so "Skip waiting" appears after a few seconds.
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  const waited = running && state.runningSince ? now - state.runningSince : 0;

  // The ring: an attribute on <html> that the Demo mode CSS reads.
  useEffect(() => {
    const root = document.documentElement;
    const focus =
      running || stuck || state.status === "idle" ? beat?.focus : null;
    if (focus) root.dataset.demoFocus = focus;
    else delete root.dataset.demoFocus;
    return () => {
      delete root.dataset.demoFocus;
    };
  }, [beat?.focus, running, stuck, state.status]);
  const ask = (kind: "back" | "exit") => {
    if (running) setConfirm(kind);
    else if (kind === "back") onBack();
    else onExit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      ask("exit");
    } else if (
      event.key === "ArrowRight" &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      void engine.next();
    } else if (event.key === "Enter" && event.target === event.currentTarget) {
      event.preventDefault();
      void engine.next();
    }
  };

  const beatNumber = Math.min(state.index + 1, total);
  const asked = state.log.filter((entry) => entry.kind === "done").length;

  return (
    <>
      <section
        aria-label="Demo mode guide"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the region itself takes focus so Enter and the arrow keys work
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-edge={edge}
        className="hx-demo-bar"
      >
        {folded && !stuck ? (
          <div className="mx-auto flex w-full max-w-4xl items-center gap-2 px-3 py-1.5 sm:px-4">
            <p className="min-w-0 flex-1 truncate text-xs">
              <span className="eyebrow text-[0.65rem] text-ink-muted">
                Demo mode
              </span>{" "}
              <span className="font-mono text-ink-muted">
                {state.finished ? "Done" : `${beatNumber}/${total}`}
              </span>{" "}
              <span className="font-semibold">{scenario.title}</span>
            </p>
            {state.finished ? null : (
              <Button
                size="sm"
                variant="primary"
                pending={running}
                pendingLabel={state.pending ?? "Working…"}
                onClick={() => void engine.next()}
              >
                Next
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFolded(false)}
              aria-expanded={false}
            >
              Show guide
            </Button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-1.5 px-3 py-2 sm:px-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="min-w-0 flex-1 truncate text-xs font-semibold">
                <span className="eyebrow text-[0.65rem] text-ink-muted">
                  Demo mode
                </span>{" "}
                {scenario.title}
              </p>
              <p className="font-mono text-xs text-ink-muted">
                {state.finished ? "Done" : `Beat ${beatNumber} of ${total}`}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEdge(edge === "bottom" ? "top" : "bottom")}
                aria-label={
                  edge === "bottom"
                    ? "Move the guide to the top"
                    : "Move the guide to the bottom"
                }
              >
                {edge === "bottom" ? "Move up" : "Move down"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFolded(true)}
                aria-expanded={true}
                disabled={stuck}
              >
                Hide guide
              </Button>
            </div>

            <p aria-live="polite" className="text-sm leading-snug">
              {state.finished
                ? "That is the end of this Scenario. Everything it made is in your Workspace: the Session, the Runs and the Audit trail. Go back to the scenarios to try another, or exit and carry on by hand."
                : beat?.say}
            </p>

            {state.notice ? (
              <p className="rounded-sm border border-amber-700/30 bg-amber-50 px-3 py-1.5 text-sm text-ink">
                {state.notice}
              </p>
            ) : null}

            {stuck && state.problem ? (
              <output className="block space-y-1 rounded-sm outline-box bg-morning-haze/40 px-3 py-2 text-sm">
                <p className="font-medium">
                  {state.status === "drifted"
                    ? "The Agent did not do this one on its own."
                    : "That was refused or failed."}
                </p>
                <p className="text-xs text-ink-muted">{state.problem}</p>
                <p className="text-xs">
                  {state.recover.includes("start")
                    ? "“Start it for me” starts the Run through the same call as the Start button, marked as started from Demo mode."
                    : "Retry it, or skip it and go on."}
                </p>
              </output>
            ) : null}

            {beat?.links && !state.finished ? (
              <p className="flex flex-wrap gap-x-4 text-sm">
                {beat.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-federal-blue underline underline-offset-2"
                  >
                    {link.label} (opens in a new tab)
                  </a>
                ))}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {state.finished ? null : stuck ? (
                <>
                  {state.recover.includes("start") ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void engine.recover("start")}
                    >
                      Start it for me
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant={
                      state.recover.includes("start") ? "secondary" : "primary"
                    }
                    onClick={() => void engine.retry()}
                  >
                    Retry
                  </Button>
                  {state.recover.includes("ask-again") ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      title={beat?.onDrift?.askAgain}
                      onClick={() => void engine.recover("ask-again")}
                    >
                      Ask again
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => engine.skip()}
                  >
                    Skip
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  pending={running}
                  pendingLabel={state.pending ?? "Working…"}
                  onClick={() => void engine.next()}
                >
                  Next
                </Button>
              )}
              {running ? (
                <span className="font-mono text-xs text-ink-muted">
                  {Math.floor(waited / 1000)}s
                </span>
              ) : null}
              {running && waited >= SKIP_AFTER_MS ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => engine.skipWaiting()}
                >
                  Skip waiting
                </Button>
              ) : null}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => ask("back")}>
                Back to scenarios
              </Button>
              <Button size="sm" variant="ghost" onClick={() => ask("exit")}>
                Exit
              </Button>
            </div>

            {state.log.length > 0 ? (
              <details className="text-xs text-ink-muted">
                <summary className="cursor-pointer select-none">
                  What has been done ({asked})
                </summary>
                <ol className="hx-scroll mt-1 max-h-24 space-y-0.5 pl-4">
                  {state.log.map((entry) => (
                    <li
                      key={entry.id}
                      className={cx(
                        "list-decimal",
                        entry.kind === "problem" && "text-seal-red",
                      )}
                    >
                      <span className="font-mono">Beat {entry.beat + 1}:</span>{" "}
                      {entry.text}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
            <p className="sr-only">
              Press the right arrow or Enter for Next, Escape to exit.
            </p>
          </div>
        )}
      </section>

      {confirm ? (
        <ConfirmDialog
          title={confirm === "exit" ? "Exit Demo mode?" : "Back to scenarios?"}
          confirm={confirm === "exit" ? "Exit" : "Back to scenarios"}
          pendingLabel="Leaving…"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            if (confirm === "exit") onExit();
            else onBack();
          }}
        >
          A Beat is in progress. Leaving now stops the guide waiting for it. If
          it has already sent something, that carries on in your Workspace.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

// Resume hint -----------------------------------------------------------------------------

/**
 * A small offer to carry on with a Scenario that was in progress. It does not
 * open Demo mode by itself: the picker opens only from the Demo mode button.
 */
function ResumeHint({
  title,
  beat,
  total,
  onContinue,
  onDismiss,
}: {
  title: string;
  beat: number;
  total: number;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-label="Continue where you left off"
      className="fixed right-3 bottom-3 left-3 z-40 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm outline-box bg-paper px-3 py-2 shadow-lg sm:left-auto sm:w-96"
    >
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Continue where you left off</span>
        <span className="block text-xs text-ink-muted">
          {title}, Beat {beat} of {total}
        </span>
      </p>
      <Button size="sm" variant="primary" onClick={onContinue}>
        Continue
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </section>
  );
}
