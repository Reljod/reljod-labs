"use client";

import { motion, useReducedMotion } from "motion/react";
import { Panel } from "@/features/harness/components/ui";
import { INSTRUCTIONS } from "../domain/brief";
import {
  DRAWING_LIMITS,
  DRAWING_VERSION,
  SHEET_WIDTH,
} from "../domain/drawing";
import { LIMITS } from "../domain/limits";
import { COLOUR_SPAN } from "../domain/ruler";
import type { PassRecord } from "./use-trace";

const STEPS = [
  {
    title: "Screenshot",
    body: "Yours or a Sample, shrunk to at most 1600 px and squared up with a 100-unit grid.",
  },
  {
    title: "GPT-6.2 Astra",
    body: "Reads the pixels and writes a Drawing: palette, type scale, then every mark, back to front.",
  },
  {
    title: "Drawing",
    body: `${DRAWING_VERSION}: boxes, ellipses, lines and text on a ${SHEET_WIDTH}-unit Sheet. Data, never HTML.`,
  },
  {
    title: "The Ruler",
    body: "Code renders the Drawing and compares it with the screenshot, cell by cell.",
  },
  {
    title: "Notes",
    body: `The ${LIMITS.notes} worst cells, as numbers, go back with the rendering for another Pass.`,
  },
];

/** The loop, drawn: a token travels round it for as long as the tab is open. */
function Loop() {
  const reduce = useReducedMotion();
  return (
    <ol className="relative grid grid-cols-1 gap-3 sm:grid-cols-5">
      {STEPS.map((step, index) => (
        <motion.li
          key={step.title}
          className="outline-box relative rounded-sm bg-paper p-3 shadow-hard-sm"
          initial={reduce ? false : { y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: index * 0.12 }}
        >
          <motion.span
            className="absolute -top-2 -left-2 flex h-6 w-6 items-center justify-center rounded-sm border-2 border-ink bg-brass font-mono text-[0.7rem] font-bold"
            animate={reduce ? undefined : { scale: [1, 1.25, 1] }}
            transition={{
              duration: 0.6,
              delay: 1 + index * 0.6,
              repeat: Number.POSITIVE_INFINITY,
              repeatDelay: STEPS.length * 0.6 - 0.6,
            }}
          >
            {index + 1}
          </motion.span>
          <p className="mb-1 font-mono text-xs font-bold uppercase">
            {step.title}
          </p>
          <p className="font-mono text-[0.68rem] leading-relaxed text-ink-muted">
            {step.body}
          </p>
        </motion.li>
      ))}
    </ol>
  );
}

export function UnderTheHood({
  last,
  model,
}: {
  last: PassRecord | null;
  model: string | null;
}) {
  const json = last
    ? JSON.stringify(
        { ...last.drawing, marks: last.drawing.marks.slice(0, 40) },
        null,
        2,
      ) +
      (last.drawing.marks.length > 40
        ? `\n… and ${last.drawing.marks.length - 40} more marks`
        : "")
    : null;
  return (
    <div className="flex flex-col gap-4">
      <Panel
        eyebrow="The loop"
        title="A model draws; code measures"
        bodyClassName="p-4"
      >
        <Loop />
        <p className="mt-4 max-w-3xl font-mono text-[0.72rem] leading-relaxed text-ink-muted">
          GPT-6.2 Astra (OpenAI, 17 November 2026) was launched able to take a
          screenshot as a template and match its layout, colours and font sizes.
          Vellum makes that claim measurable. The model never grades itself: the
          Likeness is computed in your browser from the pixels, and only those
          numbers decide whether another Pass runs.
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          eyebrow="How the Ruler scores"
          title="Likeness = (Colour + Edges) ÷ 2"
          bodyClassName="p-4"
        >
          <ul className="flex flex-col gap-2 font-mono text-[0.72rem] leading-relaxed">
            <li>
              <b>Colour</b>: one minus the mean redmean colour distance between
              the two images, per cell; a mean distance of {COLOUR_SPAN} scores
              zero.
            </li>
            <li>
              <b>Edges</b>: SSIM on brightness over 8 × 8 windows, so text,
              borders and alignment count, not only flat colour.
            </li>
            <li>
              Both are measured on a {280}-pixel-wide copy, in a grid of 20
              cells across. The heat map is that grid; hover a cell to see both
              colours.
            </li>
            <li>
              Fonts are the system&apos;s, on the page and in the measurement
              alike, so a perfect score is out of reach by design: the Ruler
              rewards size, weight and position.
            </li>
          </ul>
        </Panel>
        <Panel
          eyebrow="Limits"
          title="What a Pass may spend"
          bodyClassName="p-4"
        >
          <ul className="grid grid-cols-2 gap-2 font-mono text-[0.72rem]">
            <li>
              Passes per hour: <b>{LIMITS.passesPerHour}</b>
            </li>
            <li>
              Passes per Trace: <b>{LIMITS.passesPerTrace}</b>
            </li>
            <li>
              Marks per Drawing: <b>{DRAWING_LIMITS.marks}</b>
            </li>
            <li>
              Image size: <b>{(LIMITS.imageBytes / 1e6).toFixed(1)} MB</b>
            </li>
            <li>
              Longest Pass: <b>{LIMITS.passSeconds}s</b>
            </li>
            <li>
              Model: <b>{model ?? "openai/gpt-6.2-astra"}</b>
            </li>
          </ul>
          <p className="mt-3 font-mono text-[0.68rem] text-ink-muted">
            Nothing is saved: the screenshot and every Drawing stay in this tab.
            Download the SVG to keep one.
          </p>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          eyebrow="What the Draftsman is told"
          title="Instructions"
          bodyClassName="p-0"
        >
          <pre className="max-h-[28rem] overflow-auto p-4 font-mono text-[0.68rem] leading-relaxed whitespace-pre-wrap">
            {INSTRUCTIONS}
          </pre>
        </Panel>
        <Panel
          eyebrow={
            last
              ? `Pass ${last.pass} · ${last.drawing.marks.length} marks`
              : "No Drawing yet"
          }
          title="The Drawing, as data"
          bodyClassName="p-0"
        >
          <pre className="max-h-[28rem] overflow-auto bg-ink p-4 font-mono text-[0.66rem] leading-relaxed text-morning-haze">
            {json ?? "Trace a screen and its Drawing appears here."}
          </pre>
        </Panel>
      </div>
    </div>
  );
}
