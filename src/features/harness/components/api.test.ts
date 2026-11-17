import { afterEach, describe, expect, it, vi } from "vitest";
import { apiPath } from "../domain/api";
import type { SourceView } from "../domain/knowledge";
import { api } from "./api";
import { isAttachedOnly } from "./knowledge/sources-list";

const source = (change: Partial<SourceView>): SourceView => ({
  id: "s1",
  title: "Case paper",
  kind: "pdf",
  bytes: 10,
  isSeed: false,
  status: "pending",
  error: null,
  addedBy: null,
  sessionId: "sess",
  documentDate: null,
  passages: 0,
  openConflicts: 0,
  createdAt: "2026-11-17T00:00:00.000Z",
  ...change,
});

describe("api.sources.attach (a chat attachment)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers and uploads the file and never asks the server to read it", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return new Response(
          JSON.stringify({
            source: source({}),
            uploadUrl: "https://storage.test/put",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    class FakeXhr {
      status = 200;
      upload: Record<string, unknown> = {};
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);

    const result = await api.sources.attach(
      new File(["x"], "case.pdf", { type: "application/pdf" }),
      { sessionId: "sess" },
    );
    expect(result.status).toBe("pending");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/sources/upload-url");
    expect(calls.some((url) => url.includes("/ingest"))).toBe(false);
  });
});

describe("isAttachedOnly", () => {
  it("is a pending Source attached in a Session", () => {
    expect(isAttachedOnly(source({}))).toBe(true);
  });
  it("is not a filed Source, a failed one, or a Knowledge tab upload in flight", () => {
    expect(isAttachedOnly(source({ status: "ready" }))).toBe(false);
    expect(isAttachedOnly(source({ status: "failed" }))).toBe(false);
    expect(isAttachedOnly(source({ sessionId: null }))).toBe(false);
  });
});

describe("the Audit query", () => {
  it("asks the server for an admin's own Sessions, not the whole Workspace", () => {
    expect(apiPath.audit({ mine: true, limit: 50 })).toContain("mine=1");
    expect(apiPath.audit({ limit: 50 })).not.toContain("mine");
  });
});
