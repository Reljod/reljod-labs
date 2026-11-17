/** Small formatters shared by the chat and the Pipeline view. */

/** `850 ms`, `4.2 s`, `2 min 5 s`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60)
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** `1.2k` for a token count. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** `just now`, `5 min ago`, `3 h ago`, `2 d ago`, then the date. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} d ago`;
  return new Date(then).toLocaleDateString("en", {
    day: "numeric",
    month: "short",
  });
}

/** `member_request` to `Member request`, for a Pipeline the catalogue does not know. */
export function humanize(id: string): string {
  const text = id.replace(/[_-]+/g, " ").trim();
  return text ? text[0]?.toUpperCase() + text.slice(1) : id;
}
