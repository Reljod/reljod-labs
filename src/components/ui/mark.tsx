/** The Colonnade mark: a geometric pediment over four columns. */
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
      <path d="M3 11L16 4l13 7z" />
      <path d="M7 14v12M13 14v12M19 14v12M25 14v12M3 28h26" />
    </svg>
  );
}
