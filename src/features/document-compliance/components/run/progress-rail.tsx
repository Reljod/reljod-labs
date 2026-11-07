"use client";

import { motion } from "motion/react";
import type { FieldCheck } from "../../domain/field-checks";
import type { DocumentKind } from "../../domain/types";
import type { Pack } from "../../packs";
import type { ScanStage } from "../../scan-events";
import type { DocumentScan, StageState } from "../../scan-state";
import { CHECK_STYLES, DOCUMENT_SHORT_LABELS } from "../labels";
import { pageImageUrl } from "../page-image";

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
  onScreen: number | null;
  reduceMotion: boolean;
};

/** Every Document in the pack with its live stage progress; the one on screen is raised. */
export function ProgressRail({
  pack,
  kinds,
  documents,
  onScreen,
  reduceMotion,
}: ProgressRailProps) {
  return (
    <ol className="grid grid-cols-3 gap-2 sm:gap-4" aria-label="Documents">
      {kinds.map((kind, index) => {
        const scan = documents[kind];
        const file = pack.documents.find((item) => item.kind === kind)
          ?.pages[0];
        const outcome = worst(scan.checks);
        const active = index === onScreen;
        return (
          <motion.li
            key={kind}
            data-testid={`progress-${kind}`}
            data-active={active}
            animate={{ y: active ? -4 : 0 }}
            className={`outline-box flex items-center gap-2 rounded-sm p-1.5 sm:gap-3 sm:p-2 ${
              active ? "bg-morning-haze shadow-hard-md" : "bg-paper"
            }`}
          >
            <span className="relative hidden h-12 w-10 shrink-0 overflow-hidden rounded-[1px] border border-ink sm:block">
              {file ? (
                // biome-ignore lint/performance/noImgElement: signed Storage redirect thumbnail
                <img
                  src={pageImageUrl(pack.slug, file)}
                  alt=""
                  className="size-full object-cover object-top"
                />
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
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}
