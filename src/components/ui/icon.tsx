/** Colonnade icons: 2px ink stroke, square caps, no fills. */
const paths = {
  "id-card": (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16h6M14 10h4M14 14h4" />
    </>
  ),
  "document-check": (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4M9 14l2 2 4-4" />
    </>
  ),
  match: (
    <>
      <rect x="3" y="4" width="7" height="7" />
      <rect x="14" y="13" width="7" height="7" />
      <path d="M10 7.5h4.5v5.5M13 11l1.5 2 1.5-2" />
    </>
  ),
  agents: (
    <>
      <rect x="9" y="3" width="6" height="5" />
      <rect x="3" y="16" width="6" height="5" />
      <rect x="15" y="16" width="6" height="5" />
      <path d="M12 8v4M6 16v-4h12v4" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4-6M4 18h16" />
    </>
  ),
  scan: (
    <>
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <path d="M7 12h10" />
    </>
  ),
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  send: <path d="M4 12l16-8-6 16-3-7zM11 13l9-9" />,
  replay: <path d="M4 4v6h6M5 10a8 8 0 1 1 1 6" />,
  redo: <path d="M20 4v6h-6M19 10a8 8 0 1 0-1 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  expand: <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M3 6l9 7 9-7" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
};

export function Icon({ name, size = 24, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}

/** A 48px square tile with an ink outline, the standard Colonnade icon frame. */
export function IconTile({
  name,
  className = "bg-paper",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <span
      className={`outline-box inline-flex size-12 shrink-0 items-center justify-center ${className}`}
    >
      <Icon name={name} />
    </span>
  );
}
