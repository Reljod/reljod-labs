/**
 * The Route Ledger mark: a 3x3 grid of ledger points with one route turning
 * through it, from an ink start to a brass end. The agent finds its own path
 * through a structured system. Keep `src/app/icon.svg` in step with it.
 */
export function Mark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      className={className}
    >
      <g fill="currentColor" stroke="none">
        <circle cx="7" cy="7" r="1.4" />
        <circle cx="16" cy="7" r="1.4" />
        <circle cx="7" cy="16" r="1.4" />
        <circle cx="25" cy="16" r="1.4" />
        <circle cx="16" cy="25" r="1.4" />
        <circle cx="25" cy="25" r="1.4" />
        <circle cx="7" cy="25" r="2.2" />
      </g>
      <path d="M7 25V16h9V7h6" />
      <circle cx="25" cy="7" r="2.8" className="fill-brass" stroke="none" />
    </svg>
  );
}
