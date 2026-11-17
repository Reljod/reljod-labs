import { EMPTY_STATE, type ScenarioState } from "./engine";

/** What a reload needs to offer "Continue where you left off". Nothing else is kept. */
export type Saved = {
  scenarioId: string;
  index: number;
  state: ScenarioState;
};

export const STORAGE_KEY = "harness:demo-mode";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): Store | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readSaved(store: Store | null = defaultStore()): Saved | null {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Saved> | null;
    if (
      !value ||
      typeof value.scenarioId !== "string" ||
      typeof value.index !== "number" ||
      !Number.isInteger(value.index) ||
      value.index < 0
    ) {
      return null;
    }
    const state = (value.state ?? {}) as Partial<ScenarioState>;
    const strings = (list: unknown) =>
      Array.isArray(list)
        ? list.filter((item): item is string => typeof item === "string")
        : [];
    return {
      scenarioId: value.scenarioId,
      index: value.index,
      state: {
        ...EMPTY_STATE,
        sessionId: typeof state.sessionId === "string" ? state.sessionId : null,
        runId: typeof state.runId === "string" ? state.runId : null,
        runIds: strings(state.runIds),
        attached: strings(state.attached),
      },
    };
  } catch {
    return null;
  }
}

export function writeSaved(saved: Saved, store: Store | null = defaultStore()) {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Private windows and full quotas: Demo mode works without it.
  }
}

export function clearSaved(store: Store | null = defaultStore()) {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
