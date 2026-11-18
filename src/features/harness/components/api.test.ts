import { afterEach, describe, expect, it, vi } from "vitest";
import { apiPath } from "../domain/api";
import type { SourceView } from "../domain/knowledge";
import { api, failureOf } from "./api";
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

describe("failureOf", () => {
  it("shows the gate's plain-text refusal as it is", async () => {
    const failure = await failureOf(
      new Response("Your guest pass has ended.", { status: 401 }),
    );
    expect(failure.status).toBe(401);
    expect(failure.message).toBe("Your guest pass has ended.");
  });

  it("reads a route's JSON error and a Rule edit's field errors", async () => {
    const failure = await failureOf(
      Response.json(
        {
          error: "That edit was refused.",
          errors: [{ field: "x", message: "y" }],
        },
        { status: 400 },
      ),
    );
    expect(failure.message).toBe("That edit was refused.");
    expect(failure.errors).toHaveLength(1);
  });

  it("falls back to the status's message for an empty or HTML body", async () => {
    const empty = await failureOf(new Response("", { status: 403 }));
    expect(empty.message).toBe("Your Role may not do that.");
    const html = await failureOf(
      new Response("<html>Bad gateway</html>", { status: 502 }),
    );
    expect(html.message).toBe("That didn't work. Try again.");
  });
});
