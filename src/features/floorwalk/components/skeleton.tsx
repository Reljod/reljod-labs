/** The first paint while the visitor's allowance is read: the bar, the heading and three cards. */
export function FloorwalkSkeleton() {
  return (
    <div className="min-h-dvh bg-marble" aria-busy="true">
      <div className="h-14 border-ink border-b-2 bg-marble" />
      <div className="mx-auto max-w-[1500px] px-3 py-4 sm:px-5">
        <div className="h-4 w-56 animate-pulse rounded-sm bg-limestone" />
        <div className="mt-2 h-8 w-full max-w-2xl animate-pulse rounded-sm bg-limestone" />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="outline-box overflow-hidden rounded-sm bg-paper"
            >
              <div className="aspect-video animate-pulse bg-limestone" />
              <div className="space-y-2 p-3">
                <div className="h-3 w-24 rounded-sm bg-limestone" />
                <div className="h-4 w-40 rounded-sm bg-limestone" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
