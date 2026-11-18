import "./handover.css";

/**
 * The shape of the Start screen while the Desk loads: an intro and three
 * Sample cards. No hooks, so the page's server shell can show it too.
 */
export function DeskSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only" aria-live="polite">
        Loading…
      </span>
      <div aria-hidden="true" className="flex max-w-xl flex-col gap-2">
        <div className="ho-shimmer h-3 w-[92%] rounded-sm" />
        <div className="ho-shimmer h-3 w-[75%] rounded-sm" />
      </div>
      <div
        aria-hidden="true"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {[0, 1, 2].map((key) => (
          <div key={key} className="ho-shimmer aspect-video rounded-sm" />
        ))}
      </div>
    </div>
  );
}

/** The whole page before the address is read: the bar's place, then the Desk. */
export function HandoverSkeleton() {
  return (
    <div className="ho-ground flex min-h-dvh flex-col text-ink">
      <div
        aria-hidden="true"
        className="sticky top-0 z-30 h-[58px] shrink-0 border-ink border-b-2 bg-marble"
      />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
        <DeskSkeleton />
      </main>
    </div>
  );
}
