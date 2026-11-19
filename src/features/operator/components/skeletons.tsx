/**
 * Placeholders shaped like what is loading, so nothing jumps when it lands:
 * the stage (Trail, the terminal's bezel, the checklist) and the whole Run
 * place. Announced once as busy.
 */

import type { ReactNode } from "react";
import { DemoBar } from "@/components/demo/demo-bar";
import { GEOMETRY } from "../legacy/types";

function Busy({ label, children }: { label: string; children: ReactNode }) {
  return (
    <output
      aria-busy="true"
      aria-live="polite"
      className="block motion-safe:animate-pulse"
    >
      <span className="sr-only">{label}…</span>
      <div aria-hidden="true">{children}</div>
    </output>
  );
}

function Column({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-sm border-2 border-ink/25 bg-paper p-3">
      <div className="h-3 w-24 bg-ink/15" />
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <div key={index} className="h-7 rounded-sm bg-ink/[0.06]" />
      ))}
    </div>
  );
}

function StageShape() {
  return (
    <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)_19rem] xl:items-start">
      <div className="order-2 xl:order-1">
        <Column rows={7} />
      </div>
      <div className="order-1 flex flex-col gap-3 xl:order-2">
        <div className="rounded-sm border-2 border-ink/25 bg-limestone p-2 sm:p-3">
          <div className="mb-2 h-3 w-56 max-w-full bg-ink/15" />
          <div
            className="rounded-sm border-2 border-ink/40 bg-ink/80"
            style={{ aspectRatio: `${GEOMETRY.width} / ${GEOMETRY.height}` }}
          />
          <div className="mt-2 h-7 bg-ink/10" />
        </div>
        <div className="h-10 bg-ink/[0.06]" />
        <div className="h-20 rounded-sm border-2 border-ink/25 bg-paper" />
      </div>
      <div className="order-3">
        <Column rows={5} />
      </div>
    </div>
  );
}

/** One Run while its stored Trail loads. */
export function StageSkeleton({ label }: { label: string }) {
  return (
    <Busy label={label}>
      <StageShape />
    </Busy>
  );
}

/** The whole demo while the Owner's Runs are read with the page: the bar, the Task cards, the stage. */
export function OperatorSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBar slug="operator" name="Operator" rowFrom="xl" />
      <div className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10">
        <Busy label="Loading the Operator">
          <div className="flex flex-col gap-10">
            <div className="flex flex-col gap-3">
              <div className="h-3 w-32 bg-ink/15" />
              <div className="h-9 w-full max-w-2xl bg-ink/10" />
              <div className="h-4 w-full max-w-xl bg-ink/[0.06]" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                  key={index}
                  className="outline-box h-44 rounded-sm bg-paper"
                />
              ))}
            </div>
            <div className="flex gap-3">
              <div className="outline-box h-10 w-56 rounded-sm bg-paper" />
              <div className="outline-box h-10 w-44 rounded-sm bg-paper" />
            </div>
            <StageShape />
          </div>
        </Busy>
      </div>
    </div>
  );
}
