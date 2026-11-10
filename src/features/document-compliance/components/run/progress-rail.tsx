"use client";

import { motion } from "motion/react";
import type { FieldCheck } from "../../domain/field-checks";
import type { DocumentKind } from "../../domain/types";
import { formatUsd } from "../../metrics";
import type { Pack } from "../../packs";
import type { ScanStage } from "../../scan-events";
import type { DocumentScan, StageState } from "../../scan-state";
import { CHECK_STYLES, DOCUMENT_SHORT_LABELS } from "../labels";
import { pageImageUrl } from "../page-image";
import { PageImage } from "../page-image-loader";

const STAGES: ScanStage[] = ["parse", "read", "check"];

const STAGE_STYLE: Record<StageState, string> = {
  idle: "bg-limestone",
  active: "bg-federal-blue",
  done: "bg-ink",
  error: "bg-seal-red",
};

/** The worst Field check on a Document: what its dot shows. */
function worst(checks: FieldCheck[] | null) {
  if (!checks) return null;
  const outcomes = checks.map((check) => check.outcome);
  if (outcomes.includes("fail")) return "fail";
  if (outcomes.includes("needs_review")) return "needs_review";
  return "pass";
}

type ProgressRailProps = {
  pack: Pack;
  kinds: DocumentKind[];
  documents: Record<DocumentKind, DocumentScan>;
  onScreen: DocumentKind | null;
  onSelect: (kind: DocumentKind) => void;
  reduceMotion: boolean;
};

/**
 * Every Document in the pack with its live stage progress. The one on screen
 * is raised; clicking another puts it on screen instead.
 */
export function ProgressRail({
  pack,
  kinds,
  documents,
  onScreen,
  onSelect,
  reduceMotion,
}: ProgressRailProps) {
  return (
    <ol className="grid grid-cols-3 gap-2 sm:gap-4" aria-label="Documents">
      {kinds.map((kind) => {
        const scan = documents[kind];
        const file = pack.documents.find((item) => item.kind === kind)
          ?.pages[0];
        const outcome = worst(scan.checks);
        const active = kind === onScreen;
        const busy =
          scan.stages.parse === "active" || scan.stages.read === "active";
        return (
          <motion.li
            key={kind}
            animate={{ y: active ? -4 : 0 }}
            className="flex"
          >
            <button
              type="button"
              data-testid={`progress-${kind}`}
              data-active={active}
              aria-pressed={active}
              aria-label={`Show ${DOCUMENT_SHORT_LABELS[kind]}`}
              onClick={() => onSelect(kind)}
              className={`outline-box flex w-full items-center gap-2 rounded-sm p-1.5 text-left transition-shadow hover:shadow-hard-md sm:gap-3 sm:p-2 ${
                active ? "bg-morning-haze shadow-hard-md" : "bg-paper"
              }`}
            >
              <span className="relative hidden h-12 w-10 shrink-0 overflow-hidden rounded-[1px] border border-ink sm:block">
                {file ? (
                  <PageImage
                    src={pageImageUrl(pack.slug, file)}
                    alt=""
                    compact
                    className="relative size-full"
                    imageClassName="size-full object-cover object-top"
                  />
                ) : null}
                {busy && !reduceMotion ? (
                  <motion.span
                    aria-hidden
                    className="absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent to-clear-sky/60"
                    initial={{ top: "-35%" }}
                    animate={{ top: "100%" }}
                    transition={{
                      duration: 1.2,
                      ease: "linear",
                      repeat: Number.POSITIVE_INFINITY,
                    }}
                  >
                    <span className="absolute inset-x-0 bottom-0 h-px bg-federal-blue" />
                  </motion.span>
                ) : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="eyebrow truncate">
                    {DOCUMENT_SHORT_LABELS[kind]}
                  </span>
                  {outcome ? (
                    <motion.span
                      initial={reduceMotion ? false : { scale: 0 }}
                      animate={{ scale: 1 }}
                      title={CHECK_STYLES[outcome].label}
                      className={`grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${CHECK_STYLES[outcome].chip}`}
                    >
                      {CHECK_STYLES[outcome].mark}
                    </motion.span>
                  ) : null}
                </span>
                <span className="flex gap-1" aria-hidden>
                  {STAGES.map((stage) => (
                    <span
                      key={stage}
                      className={`relative h-1.5 flex-1 overflow-hidden rounded-full ${STAGE_STYLE[scan.stages[stage]]}`}
                    >
                      {scan.stages[stage] === "active" && !reduceMotion ? (
                        <motion.span
                          className="absolute inset-y-0 w-1/2 bg-clear-sky"
                          animate={{ left: ["-50%", "100%"] }}
                          transition={{
                            duration: 1,
                            repeat: Number.POSITIVE_INFINITY,
                            ease: "linear",
                          }}
                        />
                      ) : null}
                    </span>
                  ))}
                </span>
                <span className="hidden truncate font-mono text-[10px] text-ink-muted sm:block">
                  {scan.readings.length} field
                  {scan.readings.length === 1 ? "" : "s"}
                  {scan.usage ? ` · ${formatUsd(scan.usage.costUsd)}` : ""}
                </span>
              </span>
            </button>
          </motion.li>
        );
      })}
    </ol>
  );
}
