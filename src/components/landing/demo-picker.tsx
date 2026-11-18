"use client";

import { AnimatePresence, motion, type PanInfo } from "motion/react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BrowserFrame } from "@/components/showcase/browser-frame";
import { CaseworkPreview } from "@/components/showcase/previews/casework-preview";
import { ClientManagerPreview } from "@/components/showcase/previews/client-manager-preview";
import { DocumentCompliancePreview } from "@/components/showcase/previews/document-compliance-preview";
import { HarnessPreview } from "@/components/showcase/previews/harness-preview";
import { LedgerPreview } from "@/components/showcase/previews/ledger-preview";
import { ProcessTransferPreview } from "@/components/showcase/previews/process-transfer-preview";
import { SievePreview } from "@/components/showcase/previews/sieve-preview";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { LiveBadge } from "@/components/ui/live-badge";
import { ProjectMarks } from "@/components/ui/project-marks";
import { demoProblems, sceneNumber } from "@/content/landing";
import { liveDemos } from "@/content/projects";
import type { Project } from "@/content/types";
import { Rise } from "./reveal";

/** Each live demo's moving preview, by project slug. */
const previews: Record<string, (project: Project) => ReactNode> = {
  "document-compliance-checks": (project) => (
    <DocumentCompliancePreview project={project} />
  ),
  ledger: () => <LedgerPreview />,
  "casework-desk": () => <CaseworkPreview />,
  "client-manager": () => <ClientManagerPreview />,
  "process-transfer": () => <ProcessTransferPreview />,
  "bank-harness": () => <HarnessPreview />,
  "name-extraction": () => <SievePreview />,
};

/** How far a swipe must travel, in px, to change the demo. */
const SWIPE = 70;

const number = (index: number) => String(index + 1).padStart(2, "0");

/**
 * The projects, told as problems: pick the one that sounds like your week
 * and the demo built for it opens beside the list (below it on a phone).
 */
export function DemoPicker() {
  const [picked, setPicked] = useState(0);
  const [direction, setDirection] = useState(1);
  const count = liveDemos.length;
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const moved = useRef(false);

  function go(index: number) {
    const next = (index + count) % count;
    setDirection(
      next > picked || (picked === count - 1 && next === 0) ? 1 : -1,
    );
    setPicked(next);
    moved.current = true;
  }

  // On a phone the open demo sits under its problem, so the list shifts when
  // the pick changes; bring the new pick to the top of the screen.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    items.current[picked]?.scrollIntoView({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [picked]);

  const stageProps = {
    demo: liveDemos[picked],
    index: picked,
    count,
    direction,
    onPrevious: () => go(picked - 1),
    onNext: () => go(picked + 1),
  };

  return (
    <section
      id="demos"
      aria-labelledby="demos-title"
      className="border-ink border-t-2 bg-limestone"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <header className="mb-10 max-w-3xl">
          <p className="eyebrow mb-3 text-ink-muted">
            {sceneNumber("demos")} · The projects
          </p>
          <h2
            id="demos-title"
            className="font-mono text-3xl leading-[1.12] font-bold uppercase sm:text-4xl"
          >
            Pick a problem. See what I built for it.
          </h2>
          <Rise>
            <p className="mt-4 text-lg text-ink-muted">
              Each one is a working demo: real AI over made-up paperwork. They
              open with a guest code, so ask me for one.
            </p>
          </Rise>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
          <ol className="space-y-3">
            {liveDemos.map((demo, index) => {
              const active = index === picked;
              return (
                <li
                  key={demo.slug}
                  ref={(element) => {
                    items.current[index] = element;
                  }}
                  className="scroll-mt-20"
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => go(index)}
                    className={`outline-box flex w-full items-start gap-4 rounded-sm p-4 text-left transition-[background-color,translate,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-federal-blue ${active ? "-translate-x-0.5 -translate-y-0.5 bg-ink text-paper shadow-hard-md" : "bg-paper hover:bg-morning-haze"}`}
                  >
                    <span
                      className={`font-mono text-xl leading-none font-bold ${active ? "text-brass" : "text-federal-blue"}`}
                    >
                      {number(index)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block leading-snug">
                        “{demoProblems[demo.slug]}”
                      </span>
                      <span
                        className={`eyebrow mt-2 block ${active ? "text-clear-sky" : "text-ink-muted"}`}
                      >
                        {demo.title}
                      </span>
                    </span>
                  </button>
                  {active ? (
                    <div className="mt-4 mb-6 lg:hidden">
                      <Stage {...stageProps} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <div className="hidden lg:sticky lg:top-24 lg:block">
            <Stage {...stageProps} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Stage({
  demo,
  index,
  count,
  direction,
  onPrevious,
  onNext,
}: {
  demo: Project;
  index: number;
  count: number;
  direction: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const href = demo.href ?? "#demos";
  // A swipe that ends on the preview must not also open the demo.
  const swiped = useRef(false);

  function onDragEnd(_: unknown, info: PanInfo) {
    swiped.current = Math.abs(info.offset.x) > 8;
    if (info.offset.x < -SWIPE) onNext();
    else if (info.offset.x > SWIPE) onPrevious();
  }

  return (
    <article
      aria-labelledby={`stage-${demo.slug}-title`}
      className="outline-box overflow-hidden bg-marble shadow-hard-lg"
    >
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.div
          key={demo.slug}
          custom={direction}
          initial={{ opacity: 0, x: direction * 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -40 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <motion.div
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.3}
            onDragStart={() => {
              swiped.current = true;
            }}
            onDragEnd={onDragEnd}
            className="border-ink border-b-2 bg-limestone p-4 sm:p-6 lg:px-[max(1.5rem,calc(50%-15rem))]"
          >
            <Link
              href={href}
              draggable={false}
              aria-label={`Open the ${demo.title} demo`}
              onClickCapture={(event) => {
                if (swiped.current) {
                  event.preventDefault();
                  swiped.current = false;
                }
              }}
              className="group block"
            >
              <BrowserFrame address={href}>
                {previews[demo.slug]?.(demo)}
              </BrowserFrame>
            </Link>
          </motion.div>

          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-federal-blue">
                {number(index)} / {number(count - 1)}
              </span>
              <span className="eyebrow text-ink-muted">· {demo.sector}</span>
              <span className="ml-auto flex items-center gap-2">
                <ProjectMarks marks={demo.marks} />
                <LiveBadge />
              </span>
            </div>
            <h3
              id={`stage-${demo.slug}-title`}
              className="mt-3 font-mono text-2xl leading-[1.1] font-bold uppercase [overflow-wrap:anywhere]"
            >
              {demo.title}
            </h3>
            <p className="mt-3 text-ink-muted">{demo.summary}</p>
            {demo.features ? (
              <ul className="mt-4 space-y-2 text-sm">
                {demo.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden="true" className="text-ivy">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-3 border-ink border-t-2 bg-paper p-4 sm:px-6">
        <ButtonLink href={href}>
          Open the demo
          <Icon name="arrow" size={18} />
        </ButtonLink>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Previous project"
            className="outline-box press flex size-11 items-center justify-center rounded-sm bg-paper"
          >
            <Icon name="arrow" size={18} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next project"
            className="outline-box press flex size-11 items-center justify-center rounded-sm bg-paper"
          >
            <Icon name="arrow" size={18} />
          </button>
        </span>
      </div>
    </article>
  );
}
