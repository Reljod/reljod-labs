import type { ReactNode } from "react";
import { DemoBar } from "@/components/demo/demo-bar";

/**
 * The Ask session's frame while its Builds load: the same bar, the page copy
 * Ledger is about to take apart, and his desk laid out as it will be, so the
 * session page paints at once and nothing moves when the session lands.
 */
export function AskScreenSkeleton({ pageCopy }: { pageCopy: ReactNode }) {
  return (
    <div aria-busy="true">
      <DemoBar slug="ledger" name="Ledger">
        <p className="eyebrow hidden text-ink-muted sm:block">
          Ask session · Ledger rebuilds the site
        </p>
      </DemoBar>

      <div className="max-lg:pb-[50vh] lg:pr-[24rem]">{pageCopy}</div>

      <aside
        aria-label="Ledger's desk"
        className="fixed z-30 flex flex-col bg-paper max-lg:inset-x-0 max-lg:bottom-0 max-lg:h-[46vh] max-lg:border-ink max-lg:border-t-2 lg:top-16 lg:right-0 lg:bottom-0 lg:w-[24rem] lg:border-ink lg:border-l-2"
      >
        <section
          aria-label="Build board"
          className="flex min-h-0 flex-col max-lg:h-[40%] lg:flex-1"
        >
          <div className="flex items-center justify-between gap-3 border-ink border-b-2 bg-morning-haze px-4 py-3">
            <p className="eyebrow font-bold">Build board</p>
            <p className="eyebrow text-ink-muted">0 placed</p>
          </div>
          <div className="min-h-0 flex-1 bg-[repeating-linear-gradient(0deg,transparent_0_23px,rgb(20_33_61/0.06)_23px_24px)] p-3" />
        </section>
        <section
          aria-label="Chat with Ledger"
          className="flex min-h-0 flex-1 flex-col border-ink border-t-2"
        >
          <div className="flex items-center justify-between gap-3 border-ink border-b-2 bg-morning-haze px-4 py-3">
            <p className="eyebrow font-bold">Ledger</p>
            <p className="eyebrow text-ink-muted">Opening the books…</p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 bg-paper p-3">
            <output aria-live="polite" className="sr-only">
              Loading the Ask session…
            </output>
            <div className="h-10 w-3/5 animate-pulse self-end rounded-sm border-2 border-limestone bg-limestone/60" />
            <div className="h-16 w-4/5 animate-pulse self-start rounded-sm border-2 border-limestone bg-marble" />
          </div>
          <div className="flex gap-2 border-ink border-t-2 bg-paper p-3">
            <div className="outline-box min-h-11 flex-1 rounded-sm bg-marble" />
            <div className="outline-box min-h-11 w-16 rounded-sm bg-federal-blue opacity-50" />
          </div>
        </section>
      </aside>
    </div>
  );
}
