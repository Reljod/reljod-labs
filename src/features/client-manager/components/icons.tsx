/** Stroke icons for the Client Manager, drawn on a 24 grid in currentColor. */

const PATHS = {
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  send: "M12 19V5M5 12l7-7 7 7",
  stop: "M7 7h10v10H7z",
  chat: "M4 5h16v11H9l-5 4z",
  people:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
  map: "M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M5 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M6.5 6.5l3.6 3.6M17.2 7l-3.4 3.4M13.8 13.8l2.8 3.6",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  profile:
    "M4 5h16v14H4zM8 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0M7 16c.6-1.8 2-2.6 3-2.6s2.4.8 3 2.6M15 9h3M15 12h3",
  close: "M6 6l12 12M18 6L6 18",
  expand: "M4 10V4h6M20 14v6h-6M4 4l6 6M20 20l-6-6",
  collapse: "M10 4v6H4M14 20v-6h6M10 10L4 4M14 14l6 6",
  sidebar: "M4 4h16v16H4zM9 4v16",
  plug: "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  check: "M5 12l5 5L20 7",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  walk: "M5 19c3-6 4-10 7-10s4 4 7 10M12 9V4",
  read: "M3 6c3-1 6-1 9 1 3-2 6-2 9-1v13c-3-1-6-1-9 1-3-2-6-2-9-1zM12 7v13",
  branch:
    "M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 6-12 3-12 9",
  add: "M7 3h7l5 5v13H7zM14 3v5h5M13 11v6M10 14h6",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = "size-4",
  strokeWidth = 2,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
