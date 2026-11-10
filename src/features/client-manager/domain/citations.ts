/**
 * The Navigator cites Nodes inline as `[[type:slug]]`. The chat renders each
 * one as a chip that lights its Node on the graph.
 */

export type AnswerPart =
  | { kind: "text"; text: string }
  | { kind: "cite"; key: string };

const CITATION = /\[\[([a-z]+:[a-z0-9-]+|client)\]\]/g;

export function splitCitations(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const index = match.index ?? 0;
    if (index > last)
      parts.push({ kind: "text", text: text.slice(last, index) });
    parts.push({ kind: "cite", key: match[1] ?? "" });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

export function citedKeys(text: string): string[] {
  return [
    ...new Set([...text.matchAll(CITATION)].map((match) => match[1] ?? "")),
  ];
}
