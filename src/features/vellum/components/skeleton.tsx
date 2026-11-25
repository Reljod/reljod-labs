/** Vellum's screen before the allowance arrives: the same three columns, still. */
export function VellumSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col" aria-busy="true">
      <span className="sr-only" aria-live="polite">
        Loading Vellum
      </span>
      <div className="h-14 border-ink border-b-2 bg-marble" />
      <div className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-[minmax(0,1fr)] gap-4 px-3 py-4 sm:px-5 sm:py-6 lg:grid-cols-[15rem_minmax(0,1fr)] 2xl:grid-cols-[15rem_minmax(0,1fr)_19rem]">
        <div className="outline-box h-[32rem] rounded-sm bg-paper" />
        <div className="outline-box h-[36rem] rounded-sm bg-[#23463a]" />
        <div className="outline-box hidden h-[32rem] rounded-sm bg-paper 2xl:block" />
      </div>
    </div>
  );
}
