"use client";

import { DemoBar, DemoBarBadge } from "@/components/demo/demo-bar";
import "./casework.css";

/** A grey bar where text will be. */
function Bar({ className }: { className: string }) {
  return <span aria-hidden="true" className={`cw-bone block ${className}`} />;
}

/** The Cabinet while its Case files load: the same header, rows in place of folders. */
export function CabinetSkeleton() {
  return (
    <section
      aria-label="Cabinet"
      aria-busy="true"
      className="flex h-full min-h-0 flex-col"
    >
      <p className="sr-only" aria-live="polite">
        Loading the Cabinet…
      </p>
      <header className="flex items-center gap-2 border-ink border-b-2 bg-ink px-3 py-2.5 text-paper">
        <p className="font-mono text-sm font-bold tracking-[0.12em] uppercase">
          Cabinet
        </p>
      </header>
      <div className="grid gap-2 border-ink/15 border-b bg-paper px-3 py-3">
        <Bar className="h-9 w-full" />
        <Bar className="h-6 w-40" />
      </div>
      <div className="grid gap-3 px-3 py-3">
        <Bar className="h-16 w-full" />
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div
            key={row}
            className="flex items-center gap-2.5 rounded-sm border-2 border-ink/15 bg-paper p-2"
          >
            <Bar className="h-11 w-8 shrink-0" />
            <span className="grid min-w-0 flex-1 gap-1.5">
              <Bar className="h-3 w-3/4" />
              <Bar className="h-2.5 w-1/2" />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The chat transcript while it loads: a few message shapes, left and right. */
export function TranscriptSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <p className="sr-only" aria-live="polite">
        Loading the chat…
      </p>
      <Bar className="ml-auto h-9 w-2/3" />
      <span className="grid gap-1.5">
        <Bar className="h-3 w-5/6" />
        <Bar className="h-3 w-4/6" />
        <Bar className="h-3 w-3/6" />
      </span>
      <Bar className="ml-auto h-9 w-1/2" />
      <span className="grid gap-1.5">
        <Bar className="h-3 w-5/6" />
        <Bar className="h-3 w-2/3" />
      </span>
    </div>
  );
}

const noop = () => {};

/** The whole desk before its first view arrives: bar, Cabinet, stage and chat, in place. */
export function DeskSkeleton() {
  return (
    <div className="cw-desk flex h-dvh min-h-[620px] flex-col overflow-hidden text-ink">
      <DemoBar
        slug="casework-desk"
        name="Teller"
        titleAs="h1"
        badge={<DemoBarBadge>Synthetic data</DemoBarBadge>}
        current="desk"
        tabs={[
          { id: "desk", label: "Desk", onSelect: noop },
          { id: "pipelines", label: "Pipelines", onSelect: noop },
        ]}
      />
      <div className="flex h-[37px] shrink-0 border-ink border-b-2 bg-paper lg:hidden" />
      <div
        aria-busy="true"
        className="relative flex min-h-0 flex-1 gap-4 px-3 pt-3 pb-3 lg:px-4 lg:pt-4 lg:pb-4"
      >
        <aside className="hidden min-h-0 w-[344px] shrink-0 overflow-hidden rounded-sm border-2 border-ink bg-marble shadow-hard-md lg:block">
          <CabinetSkeleton />
        </aside>
        <main className="hidden min-h-0 min-w-0 flex-1 flex-col gap-5 lg:flex">
          <div className="rounded-sm border-2 border-ink bg-ink p-6 shadow-hard-md">
            <Bar className="h-3 w-56 opacity-40" />
            <Bar className="mt-4 h-8 w-3/4 opacity-40" />
            <Bar className="mt-3 h-3 w-2/3 opacity-40" />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {[0, 1, 2, 3].map((card) => (
              <div
                key={card}
                className="h-40 rounded-sm border-2 border-ink bg-paper p-3.5 shadow-hard-sm"
              >
                <Bar className="h-3 w-1/2" />
                <Bar className="mt-3 h-3 w-5/6" />
                <Bar className="mt-6 h-12 w-full" />
              </div>
            ))}
          </div>
        </main>
        <section
          aria-label="Chat with the Specialist"
          className="flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-sm border-2 border-ink bg-paper shadow-hard-md lg:w-[400px] xl:w-[440px]"
        >
          <header className="flex items-center gap-2.5 border-ink border-b-2 bg-ink px-3 py-2.5 text-paper">
            <span className="size-2.5 rounded-full bg-paper/40" />
            <p className="font-mono text-sm font-bold tracking-[0.1em] uppercase">
              Specialist
            </p>
          </header>
          <div className="min-h-0 flex-1 px-4 py-4">
            <TranscriptSkeleton />
          </div>
          <div className="border-ink border-t-2 p-3">
            <Bar className="h-16 w-full" />
          </div>
        </section>
      </div>
      <div className="h-[38px] shrink-0 border-ink border-t-2 bg-ink" />
    </div>
  );
}
