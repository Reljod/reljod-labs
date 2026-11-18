/**
 * What a tab shows while its code loads, the first time it opens: a list
 * pane and a work pane, the shape every tab but Chat and Docs has. Hovering
 * a tab loads its code ahead, so this is rarely seen.
 */
export function TabLoading() {
  return (
    <div
      aria-busy="true"
      className="flex min-h-0 flex-1 gap-4 bg-marble p-3 sm:p-5"
    >
      <output aria-live="polite" className="sr-only">
        Loading…
      </output>
      <div className="hidden w-80 shrink-0 flex-col gap-2 md:flex">
        {["a", "b", "c", "d", "e"].map((key) => (
          <div
            key={key}
            className="hx-shimmer h-14 rounded-sm border-2 border-ink/20"
          />
        ))}
      </div>
      <div className="hx-shimmer min-h-64 flex-1 rounded-sm border-2 border-ink/20" />
    </div>
  );
}
