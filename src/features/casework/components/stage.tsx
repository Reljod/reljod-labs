"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { CHECKS } from "../domain/checks";
import { formatMoney } from "../domain/dates";
import { kindLabel } from "../domain/document-kinds";
import { JOBS } from "../domain/jobs";
import { PIPELINES } from "../domain/pipelines";
import type { Evidence, FieldValue, Ownership } from "../domain/run-state";
import { documentPages } from "../server/actions";
import type { DocView } from "../view";
import type { RunCard } from "./chat-panel";
import { JobGlyph, OUTCOME_STYLE } from "./glyphs";
import { ResultPage } from "./result-page";
import { type Focus, focusOf, isOver, type RunView } from "./run-reducer";

type StageProps = {
  run: RunView;
  docs: Map<string, DocView>;
  onOpenDoc: (id: string) => void;
  registerNode: (index: number, element: HTMLElement | null) => void;
  focusRef: (element: HTMLElement | null) => void;
  /** What the Run has cost, so far or in total. */
  cost?: RunCard;
};

/**
 * The stage. While a Run is going: its jobs as a track, and the step being
 * worked (or the one clicked) explained in plain words with what it has
 * found. Once it is over: the result page.
 */
export function Stage(props: StageProps) {
  const { run } = props;
  const over = isOver(run);
  // The step on show: the one clicked, or else the one being worked.
  const [picked, setPicked] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step takes the stage back
  useEffect(() => setPicked(null), [run.current]);
  const index = picked ?? run.current;
  const shown = run.jobs[index];
  const view: RunView =
    picked === null
      ? { ...run, decision: null }
      : { ...run, current: picked, decision: null };
  const focus = focusOf(view);
  const title = run.pipeline
    ? PIPELINES[run.pipeline].title
    : run.jobs.length
      ? run.jobs.map((item) => JOBS[item.job].title).join(" → ")
      : "Working it out";
  return (
    <section
      aria-label="Run"
      className="flex h-full min-h-0 flex-col gap-4 rounded-sm border-2 border-ink bg-marble/70 p-4 shadow-hard-md"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-mono text-lg font-bold tracking-[-0.01em] uppercase">
          {title}
        </h2>
        {run.inferred ? (
          <span className="rounded-sm border border-ink/40 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] text-ink-muted uppercase">
            Worked out from the documents
          </span>
        ) : null}
        <span className="ml-auto font-mono text-xs text-ink-muted">
          {run.status === "completed"
            ? "Done"
            : run.status === "failed"
              ? "Failed"
              : run.status === "stopped"
                ? "Stopped"
                : run.status === "waiting"
                  ? "Waiting on you"
                  : "Running"}
          {props.cost ? ` · $${props.cost.costUsd.toFixed(4)}` : ""}
        </span>
      </header>

      {over ? (
        <ResultPage
          run={run}
          docs={props.docs}
          onOpenDoc={props.onOpenDoc}
          cost={props.cost}
        />
      ) : (
        <>
          <Track {...props} picked={index} onPick={setPicked} />

          {shown ? (
            <div className="shrink-0 rounded-sm border-l-4 border-federal-blue bg-paper px-3 py-2.5">
              <p className="font-mono text-[11px] font-bold tracking-[0.08em] uppercase">
                Step {index + 1} of {run.jobs.length} · {JOBS[shown.job].title}
                <span className="ml-2 font-normal text-ink-muted normal-case tracking-normal">
                  {JOBS[shown.job].model
                    ? "a model does this"
                    : "rules, no model"}
                </span>
              </p>
              <p className="mt-1 text-sm leading-relaxed">
                {JOBS[shown.job].plain}
              </p>
              {shown.state === "done" && shown.summary ? (
                <p className="mt-1 text-[13px] text-ink-muted">
                  <span className="font-semibold text-ink">Found: </span>
                  {shown.summary}
                </p>
              ) : null}
            </div>
          ) : null}

          <div ref={props.focusRef} className="relative min-h-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={focusKey(focus)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="h-full"
              >
                <FocusView focus={focus} {...props} run={view} />
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      )}
    </section>
  );
}

function focusKey(focus: Focus) {
  return focus.kind === "read"
    ? `read:${focus.documentId}`
    : focus.kind === "checks"
      ? `checks:${focus.job}`
      : focus.kind;
}

function Track({
  run,
  registerNode,
  picked,
  onPick,
}: StageProps & { picked: number; onPick: (index: number) => void }) {
  return (
    <ol
      className="cw-scroll relative flex shrink-0 items-start gap-0 overflow-x-auto rounded-sm border border-ink/15 bg-marble/60 px-2 pt-3 pb-2"
      aria-label="Jobs"
    >
      {run.jobs.map((item, index) => {
        const spec = JOBS[item.job];
        const active = index === picked;
        const tone =
          item.state === "done"
            ? "bg-ink text-paper"
            : item.state === "waiting"
              ? "bg-brass text-ink cw-wait"
              : item.state === "running"
                ? "bg-federal-blue text-paper"
                : item.state === "error" || item.state === "stopped"
                  ? "bg-seal-red text-paper"
                  : "bg-paper text-ink-muted";
        return (
          <motion.li
            key={`${index}-${item.job}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: index * 0.04,
              duration: 0.25,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="relative flex min-w-[60px] flex-1 flex-col items-center"
          >
            {index > 0 ? (
              <span
                className="absolute top-[19px] right-1/2 h-[3px] w-full -translate-x-[22px] overflow-hidden bg-ink/15"
                aria-hidden="true"
              >
                <span
                  className={`block h-full transition-[width] duration-500 ${item.state === "pending" ? "w-0" : "w-full"} ${item.state === "running" ? "cw-flow" : "bg-ink"}`}
                />
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onPick(index)}
              aria-label={`${spec.title}: ${spec.plain}`}
              ref={(element) => registerNode(index, element)}
              className={`relative z-10 flex size-10 items-center justify-center rounded-sm border-2 border-ink transition-[background-color,box-shadow] duration-300 ${tone} ${active ? "shadow-hard-sm ring-2 ring-federal-blue/40 ring-offset-2 ring-offset-marble" : ""}`}
              title={spec.plain}
            >
              {item.state === "done" ? (
                <JobGlyph job={item.job} size={18} />
              ) : item.state === "waiting" ? (
                <span className="font-mono text-lg font-bold">?</span>
              ) : (
                <JobGlyph job={item.job} size={18} />
              )}
            </button>
            <span
              className={`mt-1.5 text-center font-mono text-[10px] leading-tight tracking-[0.06em] uppercase ${active ? "font-bold text-ink" : "text-ink-muted"}`}
            >
              {spec.title}
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}

function FocusView({ focus, ...props }: StageProps & { focus: Focus }) {
  switch (focus.kind) {
    case "plan":
      return <PlanView {...props} />;
    case "sort":
      return <SortView {...props} />;
    case "read":
      return <ReadView {...props} documentId={focus.documentId} />;
    case "hits":
      return <HitsView {...props} />;
    case "ownership":
      return props.run.ownership ? (
        <OwnershipView ownership={props.run.ownership} />
      ) : null;
    case "arrears":
      return <ArrearsView {...props} />;
    default:
      return <ChecksView {...props} />;
  }
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`outline-box rounded-sm bg-paper p-4 shadow-hard-md ${className}`}
    >
      {children}
    </div>
  );
}

function PlanView({ run }: StageProps) {
  const job = run.jobs[run.current];
  return (
    <div className="flex h-full items-center justify-center">
      <p className="font-mono text-sm tracking-[0.1em] text-ink-muted uppercase">
        {job ? JOBS[job.job].doing : "Laying out the jobs"}…
      </p>
    </div>
  );
}

function SortView({ run, docs, onOpenDoc }: StageProps) {
  const sorted = run.documents;
  const pending = [...docs.values()].filter(
    (doc) => !sorted.some((item) => item.id === doc.id),
  );
  const shown = [...sorted, ...pending].slice(0, 6);
  return (
    <div className="grid h-full content-center gap-4 sm:grid-cols-3">
      {shown.map((item, index) => {
        const doc = docs.get(item.id);
        const result = run.documents.find(
          (document) => document.id === item.id,
        );
        return (
          <motion.button
            type="button"
            key={item.id}
            onClick={() => onOpenDoc(item.id)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: index * 0.05,
              duration: 0.28,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="outline-box relative overflow-hidden rounded-sm bg-paper text-left shadow-hard-md"
          >
            <div className="aspect-[4/3] overflow-hidden bg-limestone/50">
              {doc?.thumbUrl ? (
                // biome-ignore lint/performance/noImgElement: signed Storage URLs
                <img
                  src={doc.thumbUrl}
                  alt=""
                  className="h-full w-full object-cover object-top"
                />
              ) : null}
            </div>
            <div className="border-ink border-t-2 p-2">
              <p className="truncate text-xs text-ink-muted">
                {doc?.name ?? item.id.slice(0, 8)}
              </p>
              <AnimatePresence>
                {result?.kind !== undefined ? (
                  <motion.p
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="mt-0.5 font-mono text-xs font-bold tracking-[0.06em] uppercase"
                  >
                    {kindLabel(result.kind ?? "other")}
                  </motion.p>
                ) : (
                  <p className="mt-0.5 font-mono text-xs text-stone">
                    Sorting…
                  </p>
                )}
              </AnimatePresence>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

function formatValue(value: FieldValue): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    if (typeof value[0] === "string") return (value as string[]).join(", ");
    return `${value.length} rows`;
  }
  return value === "" ? "Not shown" : String(value);
}

const pageCache = new Map<
  string,
  Promise<Awaited<ReturnType<typeof documentPages>>>
>();

function usePages(documentId: string) {
  const [pages, setPages] =
    useState<Awaited<ReturnType<typeof documentPages>>>(null);
  useEffect(() => {
    let live = true;
    if (!pageCache.has(documentId))
      pageCache.set(documentId, documentPages(documentId));
    pageCache.get(documentId)?.then((result) => live && setPages(result));
    return () => {
      live = false;
    };
  }, [documentId]);
  return pages;
}

export function PageWithEvidence({
  src,
  boxes,
  scanning,
}: {
  src: string;
  boxes: Evidence["boxes"];
  scanning: boolean;
}) {
  return (
    <div className="relative">
      {/* biome-ignore lint/performance/noImgElement: signed Storage URLs */}
      <img src={src} alt="Document page" className="block w-full" />
      {scanning ? (
        <span className="cw-scan pointer-events-none absolute right-0 left-0 h-8 bg-gradient-to-b from-transparent via-clear-sky/40 to-transparent" />
      ) : null}
      {boxes.map((box, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: boxes have no identity
          key={index}
          className="cw-box pointer-events-none absolute rounded-[2px] border-2 border-federal-blue bg-clear-sky/20"
          style={{
            left: `${box.x0 * 100}%`,
            top: `${box.y0 * 100}%`,
            width: `${(box.x1 - box.x0) * 100}%`,
            height: `${(box.y1 - box.y0) * 100}%`,
            animationDelay: `${index * 40}ms`,
          }}
        />
      ))}
    </div>
  );
}

function ReadView({
  run,
  documentId,
  onOpenDoc,
}: StageProps & { documentId: string }) {
  const document = run.documents.find((item) => item.id === documentId);
  const pages = usePages(documentId);
  const fields = document?.fields ?? [];
  const latest = fields.at(-1);
  const evidence = latest ? document?.evidence[latest.name] : undefined;
  const page = evidence?.page ?? 1;
  const src = pages?.pages[page - 1] ?? pages?.pages[0];
  const scanning = run.jobs[run.current]?.state === "running";
  return (
    <div className="grid h-full min-h-0 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <button
        type="button"
        onClick={() => onOpenDoc(documentId)}
        className="outline-box cw-scroll relative min-h-0 overflow-y-auto rounded-sm bg-paper text-left shadow-hard-md"
        title="Open the document"
      >
        {src ? (
          <PageWithEvidence
            src={src}
            boxes={evidence?.boxes ?? []}
            scanning={scanning}
          />
        ) : pages?.csv ? (
          <pre className="max-h-full overflow-hidden p-3 font-mono text-[10px] leading-snug">
            {pages.csv.split("\n").slice(0, 28).join("\n")}
          </pre>
        ) : (
          <div className="flex aspect-[3/4] items-center justify-center font-mono text-xs text-stone">
            Opening…
          </div>
        )}
      </button>
      <div className="flex min-h-0 flex-col gap-3">
        <p className="eyebrow text-ink-muted">Reading</p>
        <p className="font-mono text-lg leading-tight font-bold uppercase">
          {kindLabel(document?.kind ?? "other")}
        </p>
        <p className="truncate text-sm text-ink-muted">{document?.name}</p>
        <ol className="mt-2 flex flex-col gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {fields.slice(-5).map((field) => (
              <motion.li
                key={field.name}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="rounded-sm border-2 border-ink bg-paper px-3 py-2"
              >
                <p className="font-mono text-[10px] tracking-[0.08em] text-ink-muted uppercase">
                  {field.name.replaceAll("_", " ")}
                </p>
                <p className="truncate text-sm font-medium">
                  {formatValue(field.value)}
                </p>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </div>
  );
}

function Tally({ run }: { run: RunView }) {
  const count = (outcome: "pass" | "fail" | "review") =>
    run.checks.filter((check) => check.outcome === outcome).length;
  return (
    <div className="flex gap-2">
      {(["pass", "review", "fail"] as const).map((outcome) => (
        <span
          key={outcome}
          className={`rounded-sm px-2 py-1 font-mono text-xs font-bold ${OUTCOME_STYLE[outcome].tone}`}
        >
          {OUTCOME_STYLE[outcome].mark} {count(outcome)}
        </span>
      ))}
    </div>
  );
}

function WorkingView({ run }: StageProps) {
  const job = run.jobs[run.current]?.job;
  if (!job) return null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <motion.span
        animate={{ opacity: [1, 0.55, 1] }}
        transition={{
          duration: 1.8,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
        className="flex size-20 items-center justify-center rounded-sm border-2 border-ink bg-paper shadow-hard-md"
      >
        <JobGlyph job={job} size={40} />
      </motion.span>
      <p className="font-mono text-sm font-bold tracking-[0.1em] uppercase">
        {JOBS[job].doing}
      </p>
      {run.checks.length > 0 ? <Tally run={run} /> : null}
    </div>
  );
}

function ChecksView(props: StageProps) {
  const { run } = props;
  const job = run.jobs[run.current]?.job;
  const mine = run.checks.filter((check) => check.job === job);
  if (mine.length === 0 && run.jobs[run.current]?.state === "running") {
    return <WorkingView {...props} />;
  }
  const earlier = run.checks.filter((check) => !mine.includes(check));
  const shown = [...mine.toReversed(), ...earlier.toReversed()];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <p className="eyebrow text-ink-muted">
          {run.status === "stopped"
            ? "Stopped here"
            : job
              ? JOBS[job].doing
              : "Checking"}
        </p>
        <Tally run={run} />
      </div>
      <ol className="cw-scroll grid min-h-0 content-start gap-2 overflow-y-auto pr-1 pb-1">
        {shown.map((check) => (
          <li
            key={check.id}
            className={`cw-reveal flex items-start gap-3 rounded-sm border-2 bg-paper p-3 ${mine.includes(check) ? "border-ink shadow-hard-sm" : "border-ink/25"}`}
          >
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-sm font-mono text-sm font-bold ${OUTCOME_STYLE[check.outcome].tone}`}
            >
              {OUTCOME_STYLE[check.outcome].mark}
            </span>
            <div className="min-w-0">
              <p className="font-mono text-xs font-bold tracking-[0.04em] uppercase">
                {CHECKS[check.id].title}
                <span className="ml-2 font-normal text-ink-muted normal-case">
                  {JOBS[check.job].title}
                </span>
              </p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                {check.detail}
              </p>
            </div>
          </li>
        ))}
        {shown.length === 0 ? (
          <p className="text-center font-mono text-xs text-stone uppercase">
            Nothing to check yet
          </p>
        ) : null}
      </ol>
    </div>
  );
}

const DISPOSITION = {
  false_positive: { label: "Discounted", tone: "text-ivy border-ivy" },
  true_match: { label: "True match", tone: "text-seal-red border-seal-red" },
  inconclusive: { label: "Inconclusive", tone: "text-oak border-oak" },
} as const;

function HitsView({ run }: StageProps) {
  const hits = (run.hits ?? []).slice(0, 3);
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <p className="eyebrow text-ink-muted">
        {run.hits?.length} potential match{run.hits?.length === 1 ? "" : "es"}
      </p>
      {hits.map((hit, index) => (
        <motion.div
          key={`${hit.reference}-${hit.screenedName}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.07, duration: 0.26 }}
        >
          <Card className="relative">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-mono text-sm font-bold uppercase">
                {hit.hitName}
              </p>
              <span className="font-mono text-xs text-ink-muted">
                {hit.score}%
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              {hit.listType.replace("_", " ")} · {hit.listSource} · raised on{" "}
              {hit.screenedName}
            </p>
            {hit.dispositionReason ? (
              <p className="mt-2 pr-24 text-sm">{hit.dispositionReason}</p>
            ) : null}
            {hit.disposition ? (
              <span
                className={`cw-stamp absolute right-3 bottom-3 rounded-sm border-[3px] px-2 py-0.5 font-mono text-xs font-bold tracking-[0.1em] uppercase ${DISPOSITION[hit.disposition].tone}`}
              >
                {DISPOSITION[hit.disposition].label}
              </span>
            ) : null}
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

/** The ownership tree, top entity down, people at 10% or more in blue. */
export function OwnershipView({ ownership }: { ownership: Ownership }) {
  const shareholdings = ownership.links.filter(
    (link) => link.relation === "shareholding",
  );
  const levels: string[][] = [[ownership.top]];
  const placed = new Set([ownership.top.toLowerCase()]);
  for (let depth = 0; depth < 5; depth++) {
    const next = shareholdings
      .filter((link) =>
        levels[depth]?.some(
          (name) => name.toLowerCase() === link.owned.toLowerCase(),
        ),
      )
      .map((link) => link.owner)
      .filter((name) => !placed.has(name.toLowerCase()));
    if (next.length === 0) break;
    for (const name of next) placed.add(name.toLowerCase());
    levels.push([...new Set(next)]);
  }
  const ubo = new Map(
    ownership.ubos.map((item) => [item.name.toLowerCase(), item]),
  );
  const controllers = ownership.ubos.filter((item) => item.percentage === null);
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto cw-scroll">
      <p className="eyebrow text-ink-muted">Unwound to the people</p>
      <div className="flex flex-col items-center gap-3">
        {[...levels].reverse().map((level, row) => (
          <motion.div
            key={level.join("|")}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: row * 0.15 }}
            className="flex flex-wrap justify-center gap-2"
          >
            {level.map((name) => {
              const person = ubo.get(name.toLowerCase());
              const other = ownership.others.find(
                (item) => item.name.toLowerCase() === name.toLowerCase(),
              );
              const link = shareholdings.find((item) => item.owner === name);
              return (
                <div
                  key={name}
                  className={`rounded-sm border-2 px-2.5 py-1.5 text-center ${person ? "border-ink bg-federal-blue text-paper shadow-hard-sm" : other ? "border-ink/40 bg-paper text-ink-muted" : "border-ink bg-limestone"}`}
                >
                  <p className="max-w-44 truncate text-xs font-medium">
                    {name}
                  </p>
                  <p className="font-mono text-[10px]">
                    {person?.percentage != null
                      ? `${person.percentage}% effective`
                      : other?.percentage != null
                        ? `${other.percentage}%`
                        : link
                          ? `${link.percentage}% of ${link.owned.split(" ")[0]}`
                          : "Onboarding"}
                  </p>
                </div>
              );
            })}
          </motion.div>
        ))}
      </div>
      {controllers.length > 0 ? (
        <p className="text-center text-xs text-ink-muted">
          Control:{" "}
          {controllers.map((item) => `${item.name} (${item.role})`).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function ArrearsView({ run }: StageProps) {
  const arrears = run.arrears;
  if (!arrears) return null;
  const max = Math.max(...arrears.months.map((month) => month.expected), 1);
  return (
    <div className="flex h-full flex-col justify-center gap-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow text-ink-muted">Arrears</p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`font-mono text-4xl font-bold ${arrears.total > 0 ? "text-seal-red" : "text-ivy"}`}
          >
            {formatMoney(arrears.total)}
          </motion.p>
          {arrears.interest > 0 ? (
            <p className="text-sm text-ink-muted">
              plus about {formatMoney(arrears.interest)} late interest
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex h-44 items-end gap-3">
        {arrears.months.map((month, index) => (
          <div
            key={month.period}
            className="flex flex-1 flex-col items-center gap-1"
          >
            <div className="relative flex h-36 w-full max-w-16 items-end">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${(month.expected / max) * 100}%` }}
                transition={{ delay: index * 0.12 }}
                className="absolute bottom-0 w-full rounded-t-sm border-2 border-dashed border-ink/40"
              />
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${(month.paid / max) * 100}%` }}
                transition={{ delay: index * 0.12 + 0.15 }}
                className={`relative w-full rounded-t-sm border-2 border-ink ${month.short > 0 ? "bg-seal-red" : month.daysLate > 0 ? "bg-brass" : "bg-ivy"}`}
              />
            </div>
            <p className="font-mono text-[10px]">{month.period}</p>
            <p className="font-mono text-[10px] text-ink-muted">
              {month.short > 0
                ? `-${formatMoney(month.short)}`
                : month.daysLate > 0
                  ? `${month.daysLate}d late`
                  : "on time"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
