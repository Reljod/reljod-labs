import { DemoBar } from "@/components/demo/demo-bar";
import { DEMO_PATH, TABS } from "../domain/api";
import { Block } from "./shell/tab-loading";
import { tabLabel } from "./shell/tab-label";

/**
 * What Tidewater Bank shows while its first view is read on the server: the
 * real bar (its places as plain links, the clock and Staff as blocks), the
 * play-money strip, then the Bank tab's shape (the Customer rail, account
 * cards and a transactions table), so nothing moves when the app lands.
 * A server component: no client hooks.
 */
export function BankSkeleton() {
  return (
    <div className="tb-root flex h-dvh flex-col overflow-clip bg-marble text-ink">
      <DemoBar
        slug="tidewater-bank"
        name="Tidewater Bank"
        titleAs="h1"
        rowFrom="xl"
        tabs={TABS.map((tab) => ({
          id: tab,
          label: tabLabel(tab),
          href: tab === "bank" ? DEMO_PATH : `${DEMO_PATH}?tab=${tab}`,
        }))}
      >
        <Block className="h-9 w-28 sm:w-36" />
        <Block className="h-9 w-10 sm:w-32 xl:w-10 2xl:w-32" />
        <Block className="h-9 w-12 sm:w-28 xl:w-14 2xl:w-48" />
      </DemoBar>

      <div className="flex shrink-0 items-center border-ink border-b-2 bg-limestone/60 px-3 py-1 sm:px-4">
        <p className="text-[0.7rem] text-ink-muted">
          <span className="eyebrow mr-1.5 text-[0.6rem] font-bold text-ink">
            Play money
          </span>
          Tidewater Bank and the Meridian florin are fictional.
        </p>
      </div>

      <main
        aria-busy="true"
        aria-label="Loading Tidewater Bank"
        className="flex min-h-0 flex-1"
      >
        <output aria-live="polite" className="sr-only">
          Opening your bank…
        </output>
        <aside className="hidden w-72 shrink-0 flex-col gap-2 border-ink border-r-2 p-3 md:flex">
          <Block className="h-9 w-full" />
          {["a", "b", "c", "d"].map((key) => (
            <Block key={key} className="h-14 w-full" />
          ))}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
          <Block className="h-10 w-full max-w-md" />
          <div className="grid gap-3 sm:grid-cols-3">
            {["a", "b", "c"].map((key) => (
              <Block key={key} className="h-28" />
            ))}
          </div>
          <div className="outline-box rounded-sm bg-paper">
            <div className="border-ink border-b-2 px-4 py-3">
              <Block className="h-4 w-40" />
            </div>
            <div className="space-y-2 p-3">
              {["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => (
                <Block key={key} className="h-8 w-full" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
