/**
 * Searching an account's transactions by their description. The text a
 * person types is matched literally and case-insensitively: `%`, `_` and `\`
 * mean themselves, not SQL wildcards. Pure, so the read and its tests share it.
 */

/** The longest search text `list_transactions` accepts. */
export const SEARCH_CHARS = 60;

/** An `ilike` pattern (escape character `\`) that finds `query` anywhere in a description. */
export function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
