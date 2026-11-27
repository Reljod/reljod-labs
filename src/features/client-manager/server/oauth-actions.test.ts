import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  access: { kind: "host" } as unknown,
  redirects: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    state.redirects.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/features/access/server/gate", () => ({
  AccessDeniedError: class extends Error {},
  currentAccess: async () => state.access,
}));
vi.mock("./env", () => ({ env: { rateLimitSalt: () => "salt" } }));
vi.mock("./mcp-auth", () => ({
  currentGrant: async () => ({
    kind: "host",
    owner: "host:4b7f0c1e-0000-4000-8000-000000000001",
    visitor: "v",
    email: "host@example.com",
    iat: 1,
    until: Math.floor(Date.now() / 1000) + 3600,
  }),
}));

import { registerClient } from "../domain/oauth";
import { answerMcpClient } from "./oauth-actions";

const challenge = createHash("sha256")
  .update("v".repeat(43))
  .digest("base64url");

function request(callback: string, over: Record<string, string> = {}) {
  const registered = registerClient(
    { client_name: "Claude Code", redirect_uris: [callback] },
    "salt",
    Date.now(),
  );
  if (!registered.ok) throw new Error("registration");
  return new URLSearchParams({
    client_id: registered.registration.client_id,
    redirect_uri: callback,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...over,
  }).toString();
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const answer = async (fields: Record<string, string>) => {
  try {
    return await answerMcpClient(null, form(fields));
  } catch (error) {
    if ((error as Error).message === "NEXT_REDIRECT") return "redirected";
    throw error;
  }
};

beforeEach(() => {
  state.access = { kind: "host" };
  state.redirects = [];
});

describe("the consent action", () => {
  const unknown = "https://evil.example/cb";

  it("allows an unknown callback only once its host is ticked", async () => {
    expect(
      await answer({ request: request(unknown), answer: "allow" }),
    ).toEqual({ error: expect.stringMatching(/I trust evil\.example/) });
    expect(
      await answer({
        request: request(unknown),
        answer: "allow",
        trustHost: "other.example",
      }),
    ).toEqual({ error: expect.any(String) });
    expect(state.redirects).toEqual([]);
    expect(
      await answer({
        request: request(unknown),
        answer: "allow",
        trustHost: "evil.example",
      }),
    ).toBe("redirected");
    expect(state.redirects[0]).toMatch(/^https:\/\/evil\.example\/cb\?code=/);
  });

  it("needs no tick for a loopback or known client's callback", async () => {
    expect(
      await answer({
        request: request("http://127.0.0.1:5555/cb"),
        answer: "allow",
      }),
    ).toBe("redirected");
    expect(
      await answer({
        request: request("https://claude.ai/api/mcp/auth_callback"),
        answer: "allow",
      }),
    ).toBe("redirected");
  });

  it("redirects nowhere for a visitor without Access, even on Deny or a bad request", async () => {
    state.access = null;
    expect(await answer({ request: request(unknown), answer: "deny" })).toEqual(
      { error: expect.any(String) },
    );
    expect(
      await answer({
        request: request(unknown, { response_type: "token" }),
        answer: "allow",
      }),
    ).toEqual({ error: expect.any(String) });
    expect(state.redirects).toEqual([]);
  });
});
