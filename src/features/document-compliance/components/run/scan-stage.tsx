"use client";

import { AnimatePresence, motion } from "motion/react";
import type { FieldCheck } from "../../domain/field-checks";
import type { Box, FieldReading } from "../../domain/types";
import type { PackDocument } from "../../packs";
import type { DocumentPlay } from "../../playhead";
import type { DocumentScan } from "../../scan-state";
import { ConfidenceBar } from "../confidence";
import { CHECK_STYLES, DOCUMENT_LABELS, FIELD_LABELS } from "../labels";
import { pageImageUrl } from "../page-image";
import { PageImage } from "../page-image-loader";

type ScanStageProps = {
  packSlug: string;
  pack: PackDocument;
  scan: DocumentScan;
  play: DocumentPlay;
  reduceMotion: boolean;
};

const boxStyle = (box: Box) => ({
  left: `${box.x0 * 100}%`,
  top: `${box.y0 * 100}%`,
  width: `${(box.x1 - box.x0) * 100}%`,
  height: `${(box.y1 - box.y0) * 100}%`,
});

type Phase =
  | "waiting"
  | "parsing"
  | "reading"
  | "checking"
  | "checked"
  | "error";

function phaseOf(scan: DocumentScan, play: DocumentPlay): Phase {
  if (scan.stages.parse === "error" || scan.stages.read === "error") {
    return "error";
  }
  if (play.stamped) return "checked";
  if (scan.checks && play.revealed >= scan.readings.length) return "checking";
  if (scan.stages.read !== "idle" || scan.readings.length > 0) return "reading";
  if (scan.stages.parse !== "idle") return "parsing";
  return "waiting";
}

const PHASE_LABEL: Record<Phase, string> = {
  waiting: "Queued",
  parsing: "Finding text",
  reading: "Reading fields",
  checking: "Checking",
  checked: "Checked",
  error: "Failed",
};

/** One Document being scanned: the page with its boxes, and the fields read off it. */
export function ScanStage({
  packSlug,
  pack,
  scan,
  play,
  reduceMotion,
}: ScanStageProps) {
  const phase = phaseOf(scan, play);
  const revealed = scan.readings.slice(0, play.revealed);
  const checkOf = (name: string) =>
    play.stamped
      ? scan.checks?.find((check) => check.fieldName === name)
      : undefined;
  const spanByRef = new Map(scan.spans.map((span) => [span.ref, span]));
  const latest = revealed.at(-1);
  const page = latest
    ? (spanByRef.get(latest.spanRefs[0] ?? "")?.page ?? 1)
    : 1;
  return (
    <div
      data-testid="scan-stage"
      data-document-kind={scan.kind}
      data-phase={phase}
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
    >
      <div className="flex flex-col gap-2">
        <div className="relative">
          <PhaseChip phase={phase} />
          {pack.pages.length > 1 ? (
            <PageDots count={pack.pages.length} current={page} />
          ) : null}
          <AnimatePresence mode="wait">
            <motion.div
              key={`${scan.kind}-${page}`}
              initial={reduceMotion ? false : { opacity: 0, y: 24, rotate: -1 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              exit={
                reduceMotion ? undefined : { opacity: 0, y: -24, rotate: 1 }
              }
              transition={{ type: "spring", stiffness: 220, damping: 26 }}
              className="outline-box grid min-h-[40vh] place-items-center overflow-hidden rounded-sm bg-limestone shadow-hard-lg"
            >
              {/* Sized by the image alone, so boxes land where the parser found them. */}
              <PageImage
                src={pageImageUrl(packSlug, pack.pages[page - 1] ?? "")}
                alt={`${DOCUMENT_LABELS[scan.kind]}, page ${page}`}
                className="relative w-fit max-w-full"
                imageClassName="block max-h-[70vh] max-w-full"
                pendingClassName="aspect-[3/4] h-[50vh]"
              >
                {(status) =>
                  status === "loaded" ? (
                    <ScanOverlay
                      scan={scan}
                      page={page}
                      revealed={revealed}
                      checkOf={checkOf}
                      stamped={play.stamped}
                      phase={phase}
                      reduceMotion={reduceMotion}
                    />
                  ) : null
                }
              </PageImage>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <Readout
        scan={scan}
        revealed={revealed}
        checkOf={checkOf}
        phase={phase}
        reduceMotion={reduceMotion}
      />
    </div>
  );
}

function ScanOverlay({
  scan,
  page,
  revealed,
  checkOf,
  stamped,
  phase,
  reduceMotion,
}: {
  scan: DocumentScan;
  page: number;
  revealed: FieldReading[];
  checkOf: (name: string) => FieldCheck | undefined;
  stamped: boolean;
  phase: Phase;
  reduceMotion: boolean;
}) {
  const scanning = phase === "parsing" || phase === "reading";
  const spans = scan.spans.filter((span) => span.page === page);
  const spanByRef = new Map(spans.map((span) => [span.ref, span]));
  const locked = revealed.flatMap((reading) =>
    reading.spanRefs.flatMap((ref) => {
      const span = spanByRef.get(ref);
      return span ? [{ reading, span }] : [];
    }),
  );
  const tampered = new Set(scan.judgments?.tamperingSpanRefs ?? []);

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Every Span the parser found, flickering in as faint boxes. */}
      {spans.map((span, index) => (
        <motion.div
          key={span.ref}
          data-testid="scan-span"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: [0, 1, 0.35, 0.8] }}
          transition={{
            duration: 0.5,
            delay: reduceMotion ? 0 : Math.min(index * 0.012, 1.2),
          }}
          className="absolute rounded-[1px] border border-clear-sky/70 border-dashed bg-clear-sky/5"
          style={boxStyle(span.box)}
        />
      ))}

      {/* Spans a field was read from lock in, then take their check's colour. */}
      {locked.map(({ reading, span }) => {
        const check = checkOf(reading.name);
        const style = CHECK_STYLES[check?.outcome ?? "read"];
        const issue =
          check?.outcome === "fail" || check?.outcome === "needs_review";
        return (
          <motion.div
            key={`${reading.name}-${span.ref}`}
            data-testid="scan-field-box"
            data-field-name={reading.name}
            data-outcome={check?.outcome ?? "read"}
            initial={reduceMotion ? false : { opacity: 0, scale: 1.6 }}
            animate={{
              opacity: 1,
              scale: 1,
              boxShadow:
                issue && !reduceMotion
                  ? [
                      "0 0 0 0px rgba(178,58,43,0.55)",
                      "0 0 0 10px rgba(178,58,43,0)",
                    ]
                  : "0 0 0 0px rgba(0,0,0,0)",
            }}
            transition={{
              type: "spring",
              stiffness: 320,
              damping: 22,
              boxShadow: issue
                ? { duration: 1.2, repeat: Number.POSITIVE_INFINITY }
                : undefined,
            }}
            className={`absolute rounded-[2px] border-2 ${style.box}`}
            style={boxStyle(span.box)}
          />
        );
      })}

      {/* Spans the model flagged as tampered, even when no field cites them. */}
      {stamped
        ? spans
            .filter((span) => tampered.has(span.ref))
            .map((span) => (
              <motion.div
                key={`tamper-${span.ref}`}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute border-2 border-brass border-dotted"
                style={boxStyle(span.box)}
              />
            ))
        : null}

      {phase === "waiting" ? <WaitingVeil reduceMotion={reduceMotion} /> : null}
      <Viewfinder
        active={scanning || phase === "checking"}
        reduceMotion={reduceMotion}
      />
      {scanning && !reduceMotion ? (
        <Scanline fast={phase === "reading"} />
      ) : null}
    </div>
  );
}

/** A beam sweeping down the page, leaving a fading grid of read points behind it. */
function Scanline({ fast }: { fast: boolean }) {
  return (
    <motion.div
      aria-hidden
      data-testid="scanline"
      className="absolute inset-x-0 h-28"
      initial={{ top: "-20%" }}
      animate={{ top: "105%" }}
      transition={{
        duration: fast ? 1.8 : 2.6,
        ease: "easeInOut",
        repeat: Number.POSITIVE_INFINITY,
        repeatDelay: 0.15,
      }}
    >
      <div className="h-full bg-[radial-gradient(var(--color-federal-blue)_1px,transparent_1.5px)] bg-[length:10px_10px] opacity-40 [mask-image:linear-gradient(to_bottom,transparent,black)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-clear-sky/20 to-clear-sky/45" />
      <div className="relative h-0.5 bg-federal-blue shadow-[0_0_14px_3px_var(--color-clear-sky)]">
        <motion.span
          className="absolute -top-1 size-2.5 rounded-full bg-paper shadow-[0_0_10px_3px_var(--color-clear-sky)]"
          animate={{ left: ["0%", "98%", "0%"] }}
          transition={{
            duration: 1.6,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
          }}
        />
      </div>
    </motion.div>
  );
}

/** Corner brackets that lock onto the page while it is being scanned. */
function Viewfinder({
  active,
  reduceMotion,
}: {
  active: boolean;
  reduceMotion: boolean;
}) {
  const corners = [
    "left-1.5 top-1.5 border-t-4 border-l-4",
    "right-1.5 top-1.5 border-t-4 border-r-4",
    "bottom-1.5 left-1.5 border-b-4 border-l-4",
    "right-1.5 bottom-1.5 border-r-4 border-b-4",
  ];
  return (
    <AnimatePresence>
      {active
        ? corners.map((corner) => (
            <motion.span
              key={corner}
              aria-hidden
              className={`absolute size-7 border-federal-blue ${corner}`}
              initial={reduceMotion ? false : { opacity: 0, scale: 1.8 }}
              animate={
                reduceMotion
                  ? { opacity: 1 }
                  : { opacity: [1, 0.55, 1], scale: [1, 0.92, 1] }
              }
              exit={{ opacity: 0, scale: 1.4 }}
              transition={{
                duration: 1.4,
                repeat: reduceMotion ? 0 : Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
            />
          ))
        : null}
    </AnimatePresence>
  );
}

/** A Document still waiting its turn: dimmed, with a slow shimmer across it. */
function WaitingVeil({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-ink/15">
      {reduceMotion ? null : (
        <motion.div
          className="absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-paper/50 to-transparent"
          initial={{ left: "-40%" }}
          animate={{ left: "120%" }}
          transition={{
            duration: 1.8,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
            repeatDelay: 0.4,
          }}
        />
      )}
    </div>
  );
}

function PhaseChip({ phase }: { phase: Phase }) {
  const live =
    phase === "parsing" || phase === "reading" || phase === "checking";
  return (
    <div className="outline-box absolute -top-3 left-3 z-10 flex items-center gap-2 rounded-sm bg-ink px-2.5 py-1 text-paper shadow-hard-sm">
      <span
        className={`size-2 rounded-full ${
          phase === "error"
            ? "bg-seal-red"
            : phase === "checked"
              ? "bg-ivy"
              : "bg-brass"
        } ${live ? "animate-pulse" : ""}`}
      />
      <span className="eyebrow">{PHASE_LABEL[phase]}</span>
    </div>
  );
}

function PageDots({ count, current }: { count: number; current: number }) {
  return (
    <div className="absolute -top-3 right-3 z-10 flex gap-1.5 rounded-sm bg-ink px-2 py-1.5">
      {Array.from({ length: count }, (_, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: pages are positional
          key={index}
          className={`h-1.5 rounded-full transition-all ${
            index + 1 === current ? "w-4 bg-paper" : "w-1.5 bg-stone"
          }`}
        />
      ))}
    </div>
  );
}

function Readout({
  scan,
  revealed,
  checkOf,
  phase,
  reduceMotion,
}: {
  scan: DocumentScan;
  revealed: FieldReading[];
  checkOf: (name: string) => FieldCheck | undefined;
  phase: Phase;
  reduceMotion: boolean;
}) {
  return (
    <section
      aria-label={`Fields read from the ${DOCUMENT_LABELS[scan.kind]}`}
      className="flex flex-col gap-3"
    >
      <h2 className="font-mono text-lg font-bold uppercase">
        {DOCUMENT_LABELS[scan.kind]}
      </h2>
      <ol className="flex flex-col gap-2" aria-live="polite">
        <AnimatePresence initial={false}>
          {revealed.map((reading, index) => (
            <FieldChip
              key={reading.name}
              reading={reading}
              check={checkOf(reading.name)}
              stampDelay={index * 0.12}
              reduceMotion={reduceMotion}
            />
          ))}
        </AnimatePresence>
        {phase === "parsing" || phase === "reading" ? (
          <li className="flex h-12 items-center gap-2 rounded-sm border-2 border-stone border-dashed px-3">
            <motion.span
              className="h-2 w-16 rounded-full bg-limestone"
              animate={reduceMotion ? undefined : { opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.1, repeat: Number.POSITIVE_INFINITY }}
            />
            <motion.span
              className="h-2 w-28 rounded-full bg-limestone"
              animate={reduceMotion ? undefined : { opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.1, repeat: Number.POSITIVE_INFINITY }}
            />
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function FieldChip({
  reading,
  check,
  stampDelay,
  reduceMotion,
}: {
  reading: FieldReading;
  check: FieldCheck | undefined;
  stampDelay: number;
  reduceMotion: boolean;
}) {
  const style = CHECK_STYLES[check?.outcome ?? "read"];
  const issue = check?.outcome === "fail" || check?.outcome === "needs_review";

  return (
    <motion.li
      layout={!reduceMotion}
      data-testid="field-chip"
      data-field-name={reading.name}
      data-outcome={check?.outcome ?? "pending"}
      initial={reduceMotion ? false : { opacity: 0, x: -40, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className={`outline-box relative flex items-start gap-3 rounded-sm px-3 py-2 ${
        issue ? "bg-paper shadow-hard-md" : "bg-paper"
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="eyebrow text-ink-muted">
          {FIELD_LABELS[reading.name]}
        </span>
        <span
          className={`break-words font-mono text-sm font-bold ${
            issue
              ? `${style.text} underline decoration-2 underline-offset-2`
              : ""
          }`}
        >
          {reading.value}
        </span>
        {issue && check?.expected ? (
          <motion.span
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ delay: stampDelay + 0.2 }}
            className="font-mono text-xs text-ink-muted"
          >
            ≠ {check.expected}
          </motion.span>
        ) : null}
        <ConfidenceBar value={reading.confidence} />
      </div>
      <AnimatePresence>
        {check ? (
          <motion.span
            key="stamp"
            title={check.note}
            aria-label={`${style.label}: ${check.note}`}
            initial={
              reduceMotion ? false : { scale: 2.6, rotate: -24, opacity: 0 }
            }
            animate={{ scale: 1, rotate: -8, opacity: 1 }}
            transition={{
              type: "spring",
              stiffness: 500,
              damping: 18,
              delay: reduceMotion ? 0 : stampDelay,
            }}
            className={`outline-box grid size-8 shrink-0 place-items-center rounded-sm font-mono text-base font-bold ${style.chip}`}
          >
            {style.mark}
          </motion.span>
        ) : (
          <span className="size-8 shrink-0" />
        )}
      </AnimatePresence>
    </motion.li>
  );
}
