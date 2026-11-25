"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DemoBar } from "@/components/demo/demo-bar";
import { Button, cx, Panel } from "@/features/harness/components/ui";
import type { Allowance } from "../domain/api";
import { type Mark, SHEET_WIDTH } from "../domain/drawing";
import { RULES, type RuleId } from "../domain/rules";
import { SAMPLES } from "../domain/samples";
import { Palette, PassTimeline, RulerGauges, Tally, TypeScale } from "./panels";
import { svgFileOf } from "./raster";
import { STAGE_VIEWS, Stage, type StageView } from "./stage";
import { UnderTheHood } from "./under-the-hood";
import { type Phase, type Source, useTrace } from "./use-trace";
import "./vellum.css";

type Tab = "trace" | "hood";

const TABS: { id: Tab; label: string }[] = [
  { id: "trace", label: "Trace" },
  { id: "hood", label: "Under the hood" },
];

const ACCEPT = "image/png,image/jpeg,image/webp";
const UPLOAD_BYTES = 12_000_000;

const PHASE_WORDS: Record<Phase, string> = {
  idle: "Pick a screen to trace",
  preparing: "Squaring up the screenshot",
  reading: "The Draftsman is reading the screen",
  drawing: "Drawing",
  measuring: "The Ruler is measuring",
  done: "Done",
  error: "Stopped",
};

function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

export function Vellum({
  initialAllowance,
}: {
  initialAllowance: Allowance | null;
}) {
  const [tab, setTab] = useState<Tab>("trace");
  const [view, setView] = useState<StageView>("trace");
  const { state, trace, stop, rulebook, setRulebook, allowance } =
    useTrace(initialAllowance);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const uploadUrl = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (uploadUrl.current) URL.revokeObjectURL(uploadUrl.current);
    },
    [],
  );

  const busy = !["idle", "done", "error"].includes(state.phase);
  const last = state.passes.at(-1) ?? null;
  const measured =
    state.passes.filter((pass) => pass.measurement !== null).at(-1)
      ?.measurement ?? null;
  const live = state.live;
  const marks: Mark[] = live ? live.marks : (last?.drawing.marks ?? []);
  const ghost = useMemo(() => {
    const map = new Map<string, Mark>();
    if (live)
      for (const mark of last?.drawing.marks ?? []) map.set(mark.id, mark);
    return map;
  }, [live, last]);
  const sheetHeight = state.shot?.sheetHeight ?? 640;
  const background = live?.background ?? last?.drawing.background ?? null;
  const palette = live?.palette.length
    ? live.palette
    : (last?.drawing.palette ?? []);
  const typeScale = live?.typeScale.length
    ? live.typeScale
    : (last?.drawing.typeScale ?? []);
  const elapsed = useElapsed(live ? live.startedAt : null);
  const left = allowance
    ? Math.max(0, allowance.perHour - allowance.used)
    : null;
  const passNumber = live?.pass ?? last?.pass ?? 0;

  const start = (source: Source) => {
    setUploadError(null);
    setView("trace");
    void trace(source);
  };

  const takeFile = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) {
      setUploadError("Drop a PNG, JPEG or WebP screenshot.");
      return;
    }
    if (file.size > UPLOAD_BYTES) {
      setUploadError("That file is over 12 MB. Try a smaller screenshot.");
      return;
    }
    if (uploadUrl.current) URL.revokeObjectURL(uploadUrl.current);
    const src = URL.createObjectURL(file);
    uploadUrl.current = src;
    start({ id: `upload-${Date.now()}`, label: file.name.slice(0, 60), src });
  };

  const download = () => {
    if (!last) return;
    const url = URL.createObjectURL(svgFileOf(last.drawing));
    const link = document.createElement("a");
    link.href = url;
    link.download = `vellum-${state.source?.id ?? "drawing"}-pass-${last.pass}.svg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const status = (() => {
    if (state.phase === "reading")
      return `${PHASE_WORDS.reading} · ${elapsed}s`;
    if (state.phase === "drawing")
      return `Pass ${live?.pass} · ${marks.length} marks · ${elapsed}s`;
    if (state.phase === "measuring") return PHASE_WORDS.measuring;
    if (state.phase === "done" && last) {
      const why =
        state.stopReason === "target"
          ? "target reached"
          : state.stopReason === "passes"
            ? "out of Passes"
            : state.stopReason === "allowance"
              ? "hourly allowance used"
              : "stopped";
      return `Traced in ${state.passes.length} ${state.passes.length === 1 ? "Pass" : "Passes"} · ${why}`;
    }
    return PHASE_WORDS[state.phase];
  })();

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBar
        slug="vellum"
        name="Vellum"
        current={tab}
        panelsId="vl"
        tabs={TABS.map((item) => ({
          id: item.id,
          label: item.label,
          testId: `vellum-tab-${item.id}`,
          onSelect: () => setTab(item.id),
        }))}
      >
        <span className="outline-box hidden items-center gap-1.5 rounded-sm bg-paper px-2 py-1 font-mono text-[0.65rem] font-bold sm:inline-flex">
          <span className="inline-block h-2 w-2 rounded-full bg-ivy motion-safe:animate-live-pulse" />
          {allowance?.model ?? "openai/gpt-6.2-astra"}
        </span>
        {left !== null && (
          <span
            className="font-mono text-[0.65rem] text-ink-muted"
            data-testid="vellum-allowance"
          >
            {left} of {allowance?.perHour} Passes left this hour
          </span>
        )}
      </DemoBar>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-5 sm:py-6">
        <div
          id="vl-panel-trace"
          role="tabpanel"
          aria-labelledby="vl-tab-trace"
          hidden={tab !== "trace"}
          className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] 2xl:grid-cols-[15rem_minmax(0,1fr)_19rem]"
        >
          {/* Left: what to trace, and the Rules */}
          <div className="flex flex-col gap-4">
            <Panel
              eyebrow="1 · Pick a screen"
              title="Screenshots"
              bodyClassName="p-3"
            >
              <ul className="grid grid-cols-2 gap-3 lg:grid-cols-1">
                {SAMPLES.map((sample) => {
                  const active = state.source?.id === sample.slug;
                  return (
                    <li key={sample.slug}>
                      <button
                        type="button"
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() =>
                          start({
                            id: sample.slug,
                            label: sample.title,
                            src: sample.src,
                          })
                        }
                        className={cx(
                          "vellum-card press outline-box group w-full overflow-hidden rounded-sm bg-paper text-left transition-[rotate,translate,box-shadow] disabled:cursor-not-allowed disabled:opacity-60",
                          active && "ring-4 ring-brass",
                        )}
                        data-testid={`vellum-sample-${sample.slug}`}
                      >
                        <span className="block h-24 overflow-hidden border-ink border-b-2 bg-limestone">
                          {/* biome-ignore lint/performance/noImgElement: a fixed-size static thumbnail. */}
                          <img
                            src={sample.thumb}
                            alt=""
                            className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                            loading="lazy"
                          />
                        </span>
                        <span className="flex items-baseline justify-between gap-2 px-2 py-1.5">
                          <span className="truncate font-mono text-[0.7rem] font-bold">
                            {sample.title}
                          </span>
                          <span className="shrink-0 font-mono text-[0.55rem] text-ink-muted uppercase">
                            {sample.kind}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  if (!busy) takeFile(event.dataTransfer.files[0]);
                }}
                className={cx(
                  "mt-3 flex w-full flex-col items-center gap-1 rounded-sm border-2 border-ink border-dashed px-3 py-4 text-center font-mono text-[0.7rem] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  dragOver ? "bg-morning-haze" : "bg-marble hover:bg-paper",
                )}
                data-testid="vellum-upload"
              >
                <span className="font-bold">Drop your own screenshot</span>
                <span className="text-ink-muted">
                  PNG, JPEG or WebP. Nothing is kept.
                </span>
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  takeFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              {uploadError && (
                <p
                  role="alert"
                  className="mt-2 font-mono text-[0.7rem] text-seal-red"
                >
                  {uploadError}
                </p>
              )}
            </Panel>

            <Panel
              eyebrow="2 · Rules"
              title="When to stop"
              bodyClassName="flex flex-col gap-3 p-3"
            >
              {(Object.keys(RULES) as RuleId[]).map((id) => {
                const rule = RULES[id];
                return (
                  <label
                    key={id}
                    className="flex flex-col gap-1 font-mono text-[0.68rem]"
                  >
                    <span className="text-ink-muted">{rule.sentence}</span>
                    <span className="flex items-center gap-2">
                      <input
                        type="range"
                        min={rule.min}
                        max={rule.max}
                        step={rule.step}
                        value={rulebook[id]}
                        disabled={busy}
                        onChange={(event) =>
                          setRulebook({
                            ...rulebook,
                            [id]: Number(event.target.value),
                          })
                        }
                        className="flex-1 accent-federal-blue"
                      />
                      <span className="w-10 text-right font-bold tabular-nums">
                        {rule.format(rulebook[id])}
                      </span>
                    </span>
                  </label>
                );
              })}
            </Panel>
          </div>

          {/* Centre: the drafting table */}
          <section className="outline-box flex min-w-0 flex-col overflow-hidden rounded-sm bg-paper shadow-hard-sm">
            <header className="flex flex-wrap items-center gap-2 border-ink border-b-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="eyebrow text-[0.65rem] font-bold text-ink-muted">
                  {state.source ? state.source.label : "The drafting table"}
                </p>
                <p
                  className="flex items-center gap-2 truncate font-mono text-sm font-bold uppercase"
                  aria-live="polite"
                  data-testid="vellum-status"
                >
                  {busy && (
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-brass motion-safe:animate-live-pulse" />
                  )}
                  {status}
                </p>
              </div>
              <fieldset className="flex">
                <legend className="sr-only">How to look at the Drawing</legend>
                {STAGE_VIEWS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={view === option.id}
                    disabled={option.id === "heat" && !last}
                    onClick={() => setView(option.id)}
                    className={cx(
                      "-ml-0.5 border-2 border-ink px-2.5 py-1 font-mono text-[0.65rem] font-bold uppercase first:ml-0 disabled:opacity-40",
                      view === option.id
                        ? "bg-ink text-paper"
                        : "bg-paper hover:bg-morning-haze",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </fieldset>
              {busy ? (
                <Button size="sm" variant="danger" onClick={stop}>
                  Stop
                </Button>
              ) : last ? (
                <Button size="sm" onClick={download}>
                  SVG ↓
                </Button>
              ) : null}
            </header>

            <div className="relative flex flex-1 flex-col">
              {state.shot ? (
                <Stage
                  src={state.shot.src}
                  sheetHeight={sheetHeight}
                  background={background}
                  marks={marks}
                  ghost={ghost}
                  phase={state.phase}
                  measurement={live ? null : (last?.measurement ?? null)}
                  pass={passNumber}
                  view={view}
                  live={Boolean(live)}
                />
              ) : (
                <EmptyTable phase={state.phase} />
              )}
              <AnimatePresence>
                {state.error && (
                  <motion.p
                    role="alert"
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="outline-box absolute inset-x-4 bottom-4 rounded-sm bg-paper px-3 py-2 font-mono text-xs text-seal-red shadow-hard-sm"
                  >
                    {state.error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </section>

          {/* Right: what it read, and what the Ruler said */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2 2xl:col-span-1 2xl:grid-cols-1">
            <Panel
              eyebrow="3 · What it saw"
              title="The read"
              bodyClassName="flex flex-col gap-4 p-3"
            >
              <Palette palette={palette} />
              <TypeScale steps={typeScale} />
              <Tally marks={marks} />
            </Panel>
            <Panel
              eyebrow="4 · What code measured"
              title="The Ruler"
              bodyClassName="flex flex-col gap-4 p-3"
            >
              <RulerGauges measurement={measured} target={rulebook.target} />
              <PassTimeline
                passes={state.passes}
                target={rulebook.target}
                livePass={live?.pass ?? null}
              />
            </Panel>
          </div>
        </div>

        <div
          id="vl-panel-hood"
          role="tabpanel"
          aria-labelledby="vl-tab-hood"
          hidden={tab !== "hood"}
        >
          <UnderTheHood last={last} model={allowance?.model ?? null} />
        </div>
      </main>
    </div>
  );
}

/** Before anything is picked: an empty sheet pinned to the mat, waiting. */
function EmptyTable({ phase }: { phase: Phase }) {
  return (
    <div className="vellum-mat flex min-h-[28rem] flex-1 items-center justify-center p-8">
      <motion.div
        initial={{ rotate: -3, y: 10, opacity: 0 }}
        animate={{ rotate: -2, y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 120, damping: 14 }}
        className="outline-box relative flex aspect-[4/3] w-full max-w-md flex-col items-center justify-center gap-3 rounded-sm bg-[#f8f6ee] p-6 text-center shadow-hard-lg"
      >
        <span
          className="absolute -top-3 left-8 h-6 w-16 rotate-[-6deg] bg-brass/80"
          aria-hidden="true"
        />
        <span
          className="absolute -top-3 right-8 h-6 w-16 rotate-[5deg] bg-brass/80"
          aria-hidden="true"
        />
        <svg viewBox="0 0 200 120" className="w-48" aria-hidden="true">
          <motion.rect
            x={10}
            y={10}
            width={180}
            height={100}
            rx={6}
            fill="none"
            stroke="#c00080"
            strokeWidth={2}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{
              duration: 1.6,
              repeat: Number.POSITIVE_INFINITY,
              repeatDelay: 1.2,
            }}
          />
          <motion.rect
            x={24}
            y={24}
            width={90}
            height={12}
            fill="#14213d"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            style={{ originX: 0 }}
            transition={{
              duration: 0.8,
              delay: 0.6,
              repeat: Number.POSITIVE_INFINITY,
              repeatDelay: 2,
            }}
          />
          <motion.rect
            x={24}
            y={80}
            width={60}
            height={18}
            rx={4}
            fill="#1d4e89"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: 0.5,
              delay: 1.1,
              repeat: Number.POSITIVE_INFINITY,
              repeatDelay: 2.3,
            }}
          />
        </svg>
        <p className="font-mono text-sm font-bold uppercase">
          {phase === "preparing"
            ? "Squaring up…"
            : "Pick a screen, or drop your own"}
        </p>
        <p className="max-w-xs font-mono text-[0.7rem] text-ink-muted">
          GPT-6.2 Astra redraws it as {SHEET_WIDTH}-unit vector marks. Code
          renders the drawing and measures it against the pixels, then hands
          back the worst spots for another Pass.
        </p>
      </motion.div>
    </div>
  );
}
