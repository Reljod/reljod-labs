/**
 * Where the Harness app is: the tab on show and what is open in it. Pure, so
 * the server page can read an address and the browser can write one.
 */

export const TAB_IDS = [
  "chat",
  "pipelines",
  "knowledge",
  "skills",
  "audit",
  "docs",
] as const;

export type TabId = (typeof TAB_IDS)[number];

export function isTabId(value: unknown): value is TabId {
  return (
    typeof value === "string" && (TAB_IDS as readonly string[]).includes(value)
  );
}

/**
 * What the address can point at besides the tab: `?tab=pipelines&run=<id>`.
 * `session` and `run` are the two the shell itself follows; the others are
 * for a tab to open one of its own things (a Skill, a Rule, a Source, a
 * Conflict, a Docs page).
 */
export const LINK_PARAMS = [
  "session",
  "run",
  "skill",
  "rule",
  "source",
  "conflict",
  "doc",
  /** `original` or `text`: a Source opens on its Preview in that view. */
  "preview",
] as const;

export type LinkParam = (typeof LINK_PARAMS)[number];
export type LinkParams = Partial<Record<LinkParam, string | null>>;

/** Where the app is: the tab, and what is open in it. */
export type Place = { tab: TabId; params: Partial<Record<LinkParam, string>> };

/** The address of a place, for a link or the address bar. */
export function hrefOf(place: Place, path = "/demos/harness"): string {
  const search = new URLSearchParams();
  if (place.tab !== "chat") search.set("tab", place.tab);
  for (const name of LINK_PARAMS) {
    const value = place.params[name];
    if (value) search.set(name, value);
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/** The place an address names. Unknown tabs fall back to Chat. */
export function placeOf(search: string | URLSearchParams): Place {
  const query =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const tab = query.get("tab");
  const params: Place["params"] = {};
  for (const name of LINK_PARAMS) {
    const value = query.get(name);
    if (value) params[name] = value;
  }
  return { tab: isTabId(tab) ? tab : "chat", params };
}
