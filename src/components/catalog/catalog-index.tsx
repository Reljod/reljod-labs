"use client";

import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import Link from "next/link";
import { type PointerEvent, useEffect, useState } from "react";
import { demoPreviews } from "@/components/landing/demo-previews";
import { BrowserFrame } from "@/components/showcase/browser-frame";
import { Icon } from "@/components/ui/icon";
import { ProjectMarks } from "@/components/ui/project-marks";
import type { CatalogEntry } from "./catalog-query";
import { Highlight } from "./highlight";
import { useCanHover } from "./use-can-hover";

/** The floating preview's width in px; its height follows the 960×726 previews plus the address bar. */
const FLOAT_WIDTH = 340;
const FLOAT_HEIGHT = Math.round((FLOAT_WIDTH * 726) / 960) + 36;
const GAP = 28;

/**
 * The catalog as a drawer index: one line per demo. Hover a line and its
 * preview rides beside the pointer, playing, and flips over like a Rolodex
 * card as you move from line to line.
 */
export function CatalogIndex({
  entries,
  terms,
}: {
  entries: CatalogEntry[];
  terms: string[];
}) {
  const canHover = useCanHover();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<CatalogEntry | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 380, damping: 32, mass: 0.6 });
  const springY = useSpring(y, { stiffness: 380, damping: 32, mass: 0.6 });
  // It leans into the way it's being dragged.
  const lean = useTransform(useVelocity(springX), [-1800, 1800], [-9, 9], {
    clamp: true,
  });

  function place(clientX: number, clientY: number) {
    const right = clientX + GAP + FLOAT_WIDTH < window.innerWidth - 12;
    x.set(right ? clientX + GAP : clientX - GAP - FLOAT_WIDTH);
    y.set(
      Math.min(
        Math.max(clientY - FLOAT_HEIGHT / 2, 84),
        window.innerHeight - FLOAT_HEIGHT - 16,
      ),
    );
  }

  // A filter can take away the line the preview belongs to.
  useEffect(() => {
    if (open && !entries.includes(open)) setOpen(null);
  }, [entries, open]);

  function follow(event: PointerEvent) {
    if (event.pointerType === "mouse") place(event.clientX, event.clientY);
  }

  return (
    <>
      <ol
        className="outline-box divide-y-2 divide-ink bg-paper shadow-hard-md"
        onPointerMove={follow}
        onPointerLeave={() => setOpen(null)}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {entries.map((entry) => (
            <motion.li
              key={entry.demo.slug}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: 24 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="bg-paper"
            >
              <Link
                href={entry.demo.href ?? "/demos"}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "mouse") return;
                  place(event.clientX, event.clientY);
                  setOpen(entry);
                }}
                onFocus={(event) => {
                  if (!canHover) return;
                  // Above the line (or below it near the top), so it never covers what has focus.
                  const box = event.currentTarget.getBoundingClientRect();
                  x.set(Math.max(12, box.right - FLOAT_WIDTH - 16));
                  const above = box.top - FLOAT_HEIGHT - 8;
                  y.set(above >= 84 ? above : box.bottom + 8);
                  setOpen(entry);
                }}
                onBlur={() => setOpen(null)}
                className="catalog-row group grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-morning-haze focus-visible:bg-morning-haze focus-visible:outline-none sm:grid-cols-[3rem_1fr_auto] sm:gap-5 sm:px-5"
              >
                <span className="font-mono text-sm font-bold text-federal-blue">
                  {entry.number}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold uppercase sm:text-lg">
                      <Highlight text={entry.demo.title} terms={terms} />
                    </span>
                    <ProjectMarks marks={entry.demo.marks} size="sm" />
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-ink-muted">
                    “<Highlight text={entry.problem} terms={terms} />”
                  </span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="eyebrow hidden text-ink-muted md:block">
                    <Highlight text={entry.demo.sector} terms={terms} />
                  </span>
                  <Icon
                    name="arrow"
                    size={18}
                    className="catalog-arrow text-federal-blue"
                  />
                </span>
              </Link>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>

      {canHover ? (
        <motion.div
          aria-hidden="true"
          className="catalog-float pointer-events-none fixed top-0 left-0 z-30 [perspective:900px]"
          style={{
            x: springX,
            y: springY,
            rotate: reduce ? 0 : lean,
            width: FLOAT_WIDTH,
          }}
        >
          <AnimatePresence mode="popLayout">
            {open ? (
              <motion.div
                key={open.demo.slug}
                initial={
                  reduce ? { opacity: 0 } : { opacity: 0, rotateX: -80, y: -12 }
                }
                animate={{ opacity: 1, rotateX: 0, y: 0 }}
                exit={
                  reduce ? { opacity: 0 } : { opacity: 0, rotateX: 80, y: 12 }
                }
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                style={{ transformOrigin: "50% 0%" }}
              >
                <div className="shadow-hard-lg">
                  <BrowserFrame address={open.demo.href ?? ""}>
                    {demoPreviews[open.demo.slug]?.(open.demo)}
                  </BrowserFrame>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </>
  );
}
