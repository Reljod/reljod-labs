import { highlightParts } from "./catalog-query";

/** A text with the current search's words marked, as a highlighter would. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  return highlightParts(text, terms).map((part, index) =>
    part.hit ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs of one fixed text
      <mark key={index} className="catalog-mark">
        {part.text}
      </mark>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs of one fixed text
      <span key={index}>{part.text}</span>
    ),
  );
}
