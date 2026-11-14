/**
 * The assistant cites the facts it used inline. Across the whole book a
 * citation names the client by Handle (the first 8 characters of their id)
 * and the Node by Key: `[[3f9a12bc/person:ivy-marsh]]`. A Thread about one
 * client may cite a bare Key, `[[person:ivy-marsh]]`. The chat renders each
 * one as a chip that opens the fact.
 */

export type AnswerPart =
  | { kind: "text"; text: string }
  | { kind: "cite"; handle: string | null; key: string };

export type Cite = { handle: string | null; key: string };

const CITATION = /\[\[(?:([0-9a-f]{8})\/)?([a-z_]+:[a-z0-9-]+|client)\]\]/g;

/** A client's Handle: short enough for a model to copy, long enough not to clash. */
export function handleOf(clientId: string) {
  return clientId.slice(0, 8).toLowerCase();
}

/** How a fact is cited, as the tools print it for the model. */
export function refOf(clientId: string, key: string) {
  return `${handleOf(clientId)}/${key}`;
}

export function splitCitations(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const index = match.index ?? 0;
    if (index > last)
      parts.push({ kind: "text", text: text.slice(last, index) });
    parts.push({ kind: "cite", handle: match[1] ?? null, key: match[2] ?? "" });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

export function citedRefs(text: string): Cite[] {
  const seen = new Set<string>();
  const cites: Cite[] = [];
  for (const match of text.matchAll(CITATION)) {
    const cite = { handle: match[1] ?? null, key: match[2] ?? "" };
    const id = `${cite.handle ?? ""}/${cite.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    cites.push(cite);
  }
  return cites;
}

/** Bare Keys cited in a text, for a graph walk about one client. */
export function citedKeys(text: string): string[] {
  return [...new Set(citedRefs(text).map((cite) => cite.key))];
}
