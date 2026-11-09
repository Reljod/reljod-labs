/** "Live" with a pulsing ivy light: the mark of a demo anyone can open now. */
export function LiveBadge({ label = "Live" }: { label?: string }) {
  return (
    <span className="outline-box eyebrow inline-flex items-center gap-2 rounded-sm bg-paper px-2 py-0.5 font-bold text-ivy">
      <span
        aria-hidden="true"
        className="size-2 rounded-full bg-ivy motion-safe:animate-live-pulse"
      />
      {label}
    </span>
  );
}
