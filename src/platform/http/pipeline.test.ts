import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("@/features/access/server/gate", () => ({
  requireAccess: vi.fn(async () => {
    throw new (class extends Error {
      status = 401;
    })();
  }),
  AccessDeniedError: class extends Error {},
}));

import { ForbiddenError, LimitError, NotFoundError } from "../errors";
import { body, sameOrigin } from "./middleware";
import { api, derive } from "./pipeline";
import { CACHE, json } from "./respond";

const call = (
  handler: ReturnType<ReturnType<typeof api>["handle"]>,
  request: Request,
) => handler(request, { params: Promise.resolve({}) });

const post = (headers: Record<string, string>, payload: unknown = {}) =>
  new Request("https://labs.example/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

describe("a route's error answer", () => {
  it("maps every service refusal to its status and never leaks an unknown error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [unknown, number, string][] = [
      [
        new ForbiddenError("Only an admin may edit Rules."),
        403,
        "Only an admin may edit Rules.",
      ],
      [new NotFoundError(), 404, "Not found"],
      [
        new LimitError("That's 6 Walks this hour."),
        429,
        "That's 6 Walks this hour.",
      ],
      [
        new Error("password=hunter2 at db.ts:12"),
        500,
        "Something went wrong on our side.",
      ],
    ];
    for (const [thrown, status, message] of cases) {
      const response = await call(
        api("t").handle(() => {
          throw thrown;
        }),
        new Request("https://labs.example/api/x"),
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    errors.mockRestore();
  });
});

describe("the layers", () => {
  it("run in order and stop at the first refusal, so the handler never runs", async () => {
    const seen: string[] = [];
    const handler = vi.fn();
    const route = api("t")
      .use(derive(() => (seen.push("one"), { one: 1 })))
      .use(
        derive(() => {
          seen.push("two");
          throw new ForbiddenError("no");
        }),
      )
      .use(derive(() => (seen.push("three"), {})))
      .handle(handler);
    const response = await call(
      route,
      new Request("https://labs.example/api/x"),
    );
    expect(response.status).toBe(403);
    expect(seen).toEqual(["one", "two"]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("revalidates shared data with an ETag, and never offers one for no-store data", async () => {
    const own = await call(
      api("t").handle(() => ({ walks: 2 })),
      new Request("https://labs.example/api/x"),
    );
    expect(own.headers.get("etag")).toBeNull();
    const route = api("t").handle(({ request }) =>
      json({ walks: 2 }, { cache: CACHE.seed, request }),
    );
    const first = await call(route, new Request("https://labs.example/api/x"));
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const again = await call(
      route,
      new Request("https://labs.example/api/x", {
        headers: { "if-none-match": etag ?? "" },
      }),
    );
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
  });
});

describe("cross-site writes", () => {
  const route = api("t")
    .use(sameOrigin())
    .handle(() => ({ ok: true }));

  it("refuses a write posted from another site", async () => {
    expect(
      (
        await call(
          route,
          post({
            "sec-fetch-site": "cross-site",
            origin: "https://evil.example",
            host: "labs.example",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          route,
          post({ origin: "https://evil.example", host: "labs.example" }),
        )
      ).status,
    ).toBe(403);
    // No Origin and no Fetch Metadata: never trusted.
    expect((await call(route, post({ host: "labs.example" }))).status).toBe(
      403,
    );
  });

  it("lets this site's own pages write", async () => {
    expect(
      (await call(route, post({ "sec-fetch-site": "same-origin" }))).status,
    ).toBe(200);
    expect(
      (
        await call(
          route,
          post({ origin: "https://labs.example", host: "labs.example" }),
        )
      ).status,
    ).toBe(200);
  });
});

describe("a body", () => {
  it("is refused before parsing when it is larger than the route takes", async () => {
    const route = api("t")
      .use(body(z.object({ q: z.string() }), { limit: 16 }))
      .handle(() => ({ ok: true }));
    const response = await call(
      route,
      post({ "sec-fetch-site": "same-origin" }, { q: "x".repeat(100) }),
    );
    expect(response.status).toBe(413);
  });
});
