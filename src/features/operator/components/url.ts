/** The Operator's places in the address: `?tab=`, `?run=<runId>`, `?replay=<taskId>`. Pure. */

export const TAB_IDS = ["run", "rules", "hood", "connect"] as const;
export type Tab = (typeof TAB_IDS)[number];

export const TAB_LABEL: Record<Tab, string> = {
  run: "Run",
  rules: "Rules",
  hood: "Under the hood",
  connect: "Connect a client",
};

export type Place = {
  tab: Tab;
  /** One of the Owner's Runs, open on the stage. */
  run: string | null;
  /** A recorded Run, by its sample Task's id. Ignored when `run` is set. */
  replay: string | null;
};

export const HOME: Place = { tab: "run", run: null, replay: null };

const ID = /^[\w.:-]{1,80}$/;
const idOf = (value: string | null) => (value && ID.test(value) ? value : null);

/** The place a query string names. Anything it does not understand is the Run place. */
export function placeOf(search: string): Place {
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  const run = idOf(params.get("run"));
  return {
    tab: TAB_IDS.includes(tab as Tab) ? (tab as Tab) : "run",
    run,
    replay: run ? null : idOf(params.get("replay")),
  };
}

/** The address of a place. The Run tab and an empty stage leave the query out. */
export function hrefOf(place: Place, pathname: string) {
  const params = new URLSearchParams();
  if (place.tab !== "run") params.set("tab", place.tab);
  if (place.run) params.set("run", place.run);
  else if (place.replay) params.set("replay", place.replay);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export const samePlace = (a: Place, b: Place) =>
  a.tab === b.tab && a.run === b.run && a.replay === b.replay;
