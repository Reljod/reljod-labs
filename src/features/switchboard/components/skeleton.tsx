/** The Call tab's shape while the first view loads: the bar, the stage, two columns. */
export function SwitchboardSkeleton() {
  const block = "outline-box rounded-sm bg-paper motion-safe:animate-pulse";
  return (
    <div className="flex min-h-dvh flex-col bg-marble" aria-busy="true">
      <div className="h-14 border-b-2 border-ink bg-paper" />
      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="flex flex-col gap-6">
          <div className="outline-box h-64 rounded-sm bg-federal-blue/80 motion-safe:animate-pulse" />
          <div className={`${block} h-72`} />
          <div className={`${block} h-56`} />
        </div>
        <div className="flex flex-col gap-6">
          <div className={`${block} h-96`} />
          <div className={`${block} h-48`} />
        </div>
      </div>
    </div>
  );
}
