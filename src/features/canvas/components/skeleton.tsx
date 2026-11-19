import { DemoBar } from "@/components/demo/demo-bar";

/** The page's shape while the Owner's Conversations and Rules are read: the bar, the Analyst's column, the canvas. */
export function CanvasSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-marble">
      <DemoBar slug="canvas" name="Canvas" />
      <div
        className="mx-auto grid w-full max-w-[1500px] flex-1 gap-4 px-3 py-4 sm:px-5 sm:py-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
        aria-hidden="true"
      >
        <div className="outline-box flex min-h-[24rem] flex-col gap-3 rounded-sm bg-paper p-4">
          <div className="h-3 w-24 bg-ink/15" />
          <div className="h-4 w-full bg-ink/[0.07]" />
          <div className="h-4 w-4/5 bg-ink/[0.07]" />
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="h-14 rounded-sm border-2 border-ink/20" />
          ))}
          <div className="mt-auto h-11 rounded-sm border-2 border-ink/20" />
        </div>
        <div className="outline-box min-h-[24rem] rounded-sm border-dashed bg-paper/60" />
      </div>
    </div>
  );
}
