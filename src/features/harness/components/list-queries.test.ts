import { afterEach, describe, expect, it, vi } from "vitest";
import type { FirstView } from "../domain/first-view";
import type { RunSummary } from "../domain/run";
import type { SessionSummary } from "../domain/session";
import { keys } from "./api";
import {
  createHarnessQueryClient,
  FRESH_MS,
  firstViewEntries,
  listQuery,
  prefetchTabData,
} from "./list-queries";

const session = { id: "s1", title: "One" } as SessionSummary;
const run = { id: "r1", status: "completed" } as RunSummary;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("firstViewEntries", () => {
  it("files each list under the key its tab reads, and the open Session's messages", () => {
    const view: FirstView = {
      sessions: [session],
      runs: [run],
      messages: { sessionId: "s1", messages: [] },
    };
    expect(firstViewEntries(view, "staff-1")).toEqual([
      [[...keys.sessions, "staff-1"], [session]],
      [keys.runs(), [run]],
      [keys.messages("s1"), []],
    ]);
  });

  it("leaves out what the server could not read", () => {
    expect(firstViewEntries({}, "staff-1")).toEqual([]);
  });

  it("keys Sessions by the Staff member, so another one's never show", () => {
    expect(listQuery("sessions", "a").queryKey).not.toEqual(
      listQuery("sessions", "b").queryKey,
    );
  });
});

describe("createHarnessQueryClient", () => {
  it("holds the first view, fresh, so a tab mounting does not read it again", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const client = createHarnessQueryClient({ runs: [run] }, "staff-1");
    const query = listQuery("runs", "staff-1");
    expect(client.getQueryData(query.queryKey)).toEqual([run]);
    // What `useQuery` does on mount: fetch only if stale.
    await client.prefetchQuery(query);
    expect(fetch).not.toHaveBeenCalled();
    expect(client.getQueryState(query.queryKey)?.isInvalidated).toBe(false);
  });

  it("reads again once the first view is older than FRESH_MS", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () =>
      Response.json({ runs: [{ ...run, id: "r2" }] }),
    );
    vi.stubGlobal("fetch", fetch);
    const client = createHarnessQueryClient({ runs: [run] }, "staff-1");
    vi.advanceTimersByTime(FRESH_MS + 1);
    await client.prefetchQuery(listQuery("runs", "staff-1"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(keys.runs())).toEqual([{ ...run, id: "r2" }]);
  });
});

describe("prefetchTabData", () => {
  it("reads ahead only the lists a tab shows that are not fresh", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return Response.json(
          url.includes("conflicts") ? { conflicts: [] } : { sources: [] },
        );
      }),
    );
    const client = createHarnessQueryClient({ sources: [] }, "staff-1");
    prefetchTabData(client, "knowledge", "staff-1");
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    expect(urls[0]).toContain("/api/harness/conflicts");
  });
});
