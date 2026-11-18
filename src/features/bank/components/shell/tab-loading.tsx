/** A block of the shape something will take, shimmering while it loads. */
export const Block = ({ className }: { className: string }) => (
  <div className={`tb-shimmer rounded-sm border-2 border-ink/20 ${className}`} />
);

/** What a tab shows while its code loads: a heading and panels, shaped like most tabs. */
export function TabLoading() {
  return (
    <div
      aria-busy="true"
      className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4"
    >
      <output aria-live="polite" className="sr-only">
        Opening the tab…
      </output>
      <Block className="h-12 w-full" />
      <div className="grid gap-3 sm:grid-cols-4">
        {["a", "b", "c", "d"].map((key) => (
          <Block key={key} className="h-20" />
        ))}
      </div>
      <Block className="min-h-48 flex-1" />
    </div>
  );
}
