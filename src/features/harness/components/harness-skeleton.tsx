import { HarnessPageBar } from "./harness-bar";

const Block = ({ className }: { className: string }) => (
  <div
    className={`hx-shimmer rounded-sm border-2 border-ink/20 ${className}`}
  />
);

/**
 * What the Harness shows while its first view is read on the server: the
 * real bar, then the Chat tab's shape (the Sessions list, the conversation
 * and the composer), so nothing moves when the app lands in its place.
 */
export function HarnessSkeleton() {
  return (
    <div className="hx-shell flex h-dvh flex-col overflow-clip">
      <div className="hx-root flex min-h-0 flex-1 flex-col bg-marble text-ink">
        <HarnessPageBar>
          <Block className="hidden h-9 w-24 sm:block" />
          <Block className="h-9 w-16 sm:w-28" />
          <Block className="h-9 w-16 sm:w-24" />
        </HarnessPageBar>
        <main
          aria-busy="true"
          className="flex min-h-0 flex-1 flex-col"
          aria-label="Loading the Harness"
        >
          <output aria-live="polite" className="sr-only">
            Opening your Workspace…
          </output>
          <div className="relative flex min-h-0 flex-1 bg-marble">
            <aside className="hidden w-72 shrink-0 flex-col gap-2 border-ink border-r-2 p-3 md:flex">
              <Block className="h-9 w-full" />
              {["a", "b", "c", "d"].map((key) => (
                <Block key={key} className="h-12 w-full" />
              ))}
            </aside>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-ink border-b-2 bg-paper px-3 py-2 sm:px-5">
                <Block className="h-5 w-40" />
              </div>
              <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-3 py-5 sm:px-5">
                <Block className="h-16 w-3/4 self-end" />
                <Block className="h-28 w-full" />
              </div>
              <div className="border-ink border-t-2 bg-paper p-3">
                <Block className="mx-auto h-24 w-full max-w-3xl" />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
