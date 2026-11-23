/** The lobby's shape while the allowance loads. */
export function FirebreakSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-marble" aria-busy="true">
      <div className="h-14 border-ink border-b-2 bg-marble" />
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-3 py-4 sm:px-5">
        <div className="h-72 animate-pulse rounded-sm border-2 border-ink bg-ink/90" />
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-52 animate-pulse rounded-sm border-2 border-ink bg-paper"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
