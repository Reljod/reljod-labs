import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("@/features/access/server/gate", () => {
  class AccessDeniedError extends Error {}
  return {
    AccessDeniedError,
    denied: () => new Response("denied", { status: 401 }),
  };
});
vi.mock("./service", () => ({ LimitError: class LimitError extends Error {} }));

import { AccessDeniedError } from "@/features/access/server/gate";
import { failure, json, NO_STORE, notFound, SEED } from "./respond";
import { LimitError } from "./service";

describe("json", () => {
  it("is never stored unless the body is seed data", () => {
    expect(json({ a: 1 }).headers.get("cache-control")).toBe(NO_STORE);
    expect(json({ a: 1 }, { cache: SEED }).headers.get("cache-control")).toBe(
      SEED,
    );
    expect(SEED).toMatch(/^private,/);
  });
});

describe("failure", () => {
  it("answers the gate's refusal with 401", () => {
    expect(failure(new AccessDeniedError()).status).toBe(401);
  });

  it("shows a limit's own words with 429", async () => {
    const response = failure(new LimitError("Too many"));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many" });
  });

  it("answers bad input with 400 and the first issue", async () => {
    const parsed = z.object({ key: z.string().min(1, "Which fact?") });
    const error = parsed.safeParse({ key: "" }).error;
    const response = failure(error);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Which fact?" });
  });

  it("hides anything else behind a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = failure(new Error("password=hunter2"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
    expect(response.headers.get("cache-control")).toBe(NO_STORE);
  });

  it("has a 404", () => {
    expect(notFound().status).toBe(404);
  });
});
