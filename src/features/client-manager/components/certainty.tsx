import {
  CERTAINTY_STYLE,
  type Certainty,
  certaintyOf,
} from "../domain/confidence";

/**
 * How sure a fact is, drawn the same way everywhere: a full dot, a half dot,
 * a hollow ring. The percentage is in the tooltip, not on the page.
 */
export function CertaintyDot({
  confidence,
  certainty,
  className = "size-2.5",
}: {
  confidence?: number;
  certainty?: Certainty;
  className?: string;
}) {
  const level = certainty ?? certaintyOf(confidence ?? 0.5);
  const style = CERTAINTY_STYLE[level];
  const title = `${style.label}${confidence !== undefined ? ` · ${Math.round(confidence * 100)}%` : ""}`;
  return (
    <svg
      viewBox="0 0 10 10"
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <circle
        cx="5"
        cy="5"
        r="4"
        fill={level === "low" ? "none" : "#fff"}
        stroke={style.color}
        strokeWidth="1.6"
      />
      {level === "high" ? (
        <circle cx="5" cy="5" r="4" fill={style.color} />
      ) : null}
      {level === "medium" ? (
        <path d="M5 1a4 4 0 0 1 0 8z" fill={style.color} />
      ) : null}
    </svg>
  );
}

/** The line a relation is drawn with on the map, as a small glyph. */
export function CertaintyLine({
  confidence,
  className = "h-2 w-6",
}: {
  confidence: number;
  className?: string;
}) {
  const level = certaintyOf(confidence);
  const style = CERTAINTY_STYLE[level];
  const title = `${style.label} · ${Math.round(confidence * 100)}%`;
  return (
    <svg
      viewBox="0 0 24 8"
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <line
        x1="1"
        y1="4"
        x2="23"
        y2="4"
        stroke={style.color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray={
          level === "high" ? undefined : level === "medium" ? "5 3" : "0.5 4"
        }
      />
    </svg>
  );
}
