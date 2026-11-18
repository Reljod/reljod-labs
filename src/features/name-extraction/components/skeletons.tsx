/**
 * Placeholders shaped like what is loading, so nothing jumps when it lands:
 * the reader (names down the side, paper pages) and a Run's comparison
 * (score card, the three lists, the pages). Announced once as busy.
 */

import type { ReactNode } from "react";
import { DemoBar } from "@/components/demo/demo-bar";

const LINES =
  "bg-[repeating-linear-gradient(180deg,rgb(20_33_61_/_0.07)_0,rgb(20_33_61_/_0.07)_6px,transparent_6px,transparent_17px)]";

function PaperSkeleton() {
  return (
    <div className="flex flex-col rounded-sm border-2 border-ink/25 bg-paper">
      <div className="h-6 border-ink/10 border-b" />
      <div className={`mx-4 my-4 aspect-[1/1.12] ${LINES}`} />
    </div>
  );
}

function PaneSkeleton({ sides = 1 }: { sides?: 1 | 2 }) {
  return (
    <div className="flex h-[min(80vh,56rem)] gap-2 sm:gap-3">
      <div className="outline-box min-w-0 flex-1 overflow-hidden rounded-sm bg-limestone p-2 sm:p-4">
        <div className={sides === 2 ? "grid gap-3 lg:grid-cols-2" : ""}>
          <PaperSkeleton />
          {sides === 2 ? (
            <div className="hidden lg:block">
              <PaperSkeleton />
            </div>
          ) : null}
        </div>
      </div>
      <div className="w-5 shrink-0 rounded-sm border-2 border-ink/25 bg-paper sm:w-6" />
    </div>
  );
}

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

/** A Run while its stored trail loads: the reader's shape. */
export function RunSkeleton({ label }: { label: string }) {
  return (
    <Busy label={label}>
      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-2 rounded-sm border-2 border-ink/25 bg-paper p-3 lg:h-[min(80vh,56rem)]">
          <div className="h-3 w-24 bg-ink/15" />
          {Array.from({ length: 8 }, (_, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
              key={index}
              className="h-7 rounded-sm bg-ink/[0.06]"
            />
          ))}
        </div>
        <PaneSkeleton />
      </div>
    </Busy>
  );
}

/** A finished demo Run while its comparison loads. */
export function ComparisonSkeleton() {
  return (
    <Busy label="Checking the run against the answer key">
      <div className="flex flex-col gap-6">
        <div className="outline-box flex flex-col items-center gap-5 rounded-sm bg-paper p-5 sm:flex-row sm:gap-8 sm:p-7">
          <div className="size-36 shrink-0 rounded-full border-[12px] sm:size-44 border-ink/10" />
          <div className="flex w-full flex-col gap-3">
            <div className="h-3 w-40 bg-ink/15" />
            <div className="h-8 w-3/4 max-w-md bg-ink/10" />
            <div className="h-3 w-1/2 max-w-sm bg-ink/10" />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
              key={index}
              className="h-24 rounded-sm border-2 border-ink/25 bg-paper"
            />
          ))}
        </div>
        <PaneSkeleton sides={2} />
      </div>
    </Busy>
  );
}

/** The whole demo while the Owner's Runs are read with the page: the bar, then the hero's shape. */
export function SieveSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBar slug="name-extraction" name="Sieve" />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-14 px-4 py-8 sm:px-6 sm:py-10">
        <Busy label="Loading Sieve">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="flex flex-col gap-4 pt-4">
              <div className="h-3 w-32 bg-ink/15" />
              <div className="h-10 w-full max-w-lg bg-ink/10" />
              <div className="h-10 w-3/4 max-w-md bg-ink/10" />
              <div className="h-4 w-full max-w-xl bg-ink/[0.06]" />
              <div className="h-4 w-2/3 max-w-lg bg-ink/[0.06]" />
              <div className="mt-2 flex gap-3">
                <div className="outline-box h-12 w-44 rounded-sm bg-paper" />
                <div className="outline-box h-12 w-36 rounded-sm bg-paper" />
              </div>
            </div>
            <div className="outline-box h-[28rem] rounded-sm bg-paper" />
          </div>
        </Busy>
      </div>
    </div>
  );
}
