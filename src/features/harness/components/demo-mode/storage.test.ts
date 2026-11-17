import { describe, expect, it } from "vitest";
import { clearSaved, readSaved, STORAGE_KEY, writeSaved } from "./storage";

function memory(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, initial);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("saved Scenario", () => {
  it("round-trips the Scenario, the Beat and the small state", () => {
    const store = memory();
    writeSaved(
      {
        scenarioId: "rule-change",
        index: 4,
        state: { sessionId: "s", runId: "r", runIds: ["r"], attached: ["a"] },
      },
      store,
    );
    expect(readSaved(store)).toEqual({
      scenarioId: "rule-change",
      index: 4,
      state: { sessionId: "s", runId: "r", runIds: ["r"], attached: ["a"] },
    });
    clearSaved(store);
    expect(readSaved(store)).toBeNull();
  });

  it("ignores junk and survives a store that throws", () => {
    expect(readSaved(memory("{nope"))).toBeNull();
    expect(
      readSaved(memory(JSON.stringify({ scenarioId: 3, index: 1 }))),
    ).toBeNull();
    expect(
      readSaved(memory(JSON.stringify({ scenarioId: "x", index: -1 }))),
    ).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSaved(broken)).toBeNull();
    expect(() =>
      writeSaved(
        {
          scenarioId: "x",
          index: 0,
          state: { sessionId: null, runId: null, runIds: [], attached: [] },
        },
        broken,
      ),
    ).not.toThrow();
    expect(() => clearSaved(broken)).not.toThrow();
  });
});
