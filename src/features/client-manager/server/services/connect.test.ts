import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Access } from "@/features/access/server/gate";
import { InvalidError, UnauthorizedError } from "@/platform/errors";
import type { McpClaims } from "../../domain/mcp-token";
import { registerClient } from "../../domain/oauth";
import { createConnectService } from "./connect";

const host: Access = {
  kind: "host",
  userId: "4b7f0c1e-0000-4000-8000-000000000001",
  email: "host@example.com",
  name: "",
};
const visitor = { hash: "v", trusted: false };

const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

function registered(callback: string) {
  const result = registerClient(
    { client_name: "Claude Code", redirect_uris: [callback] },
    "salt",
    Date.now(),
  );
  if (!result.ok) throw new Error("registration");
  return result.registration.client_id;
}

function request(callback: string, over: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: registered(callback),
    redirect_uri: callback,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...over,
  }).toString();
}

function service(
  over: Partial<Parameters<typeof createConnectService>[0]> = {},
) {
  return createConnectService({
    secret: () => "salt",
    now: Date.now,
    redeemCodeOnce: async () => true,
    verify: async () => ({}) as McpClaims,
    ...over,
  });
}

describe("the consent page", () => {
  const unknown = "https://evil.example/cb";

  it("allows an unknown callback only once its host is ticked", async () => {
    const connect = service();
    await expect(
      connect.answer(host, visitor, {
        request: request(unknown),
        answer: "allow",
      }),
    ).rejects.toThrow(/I trust evil\.example/);
    await expect(
      connect.answer(host, visitor, {
        request: request(unknown),
        answer: "allow",
        trustHost: "other.example",
      }),
    ).rejects.toBeInstanceOf(InvalidError);
    const { to } = await connect.answer(host, visitor, {
      request: request(unknown),
      answer: "allow",
      trustHost: "evil.example",
    });
    expect(to).toMatch(/^https:\/\/evil\.example\/cb\?code=/);
  });

  it("needs no tick for a loopback or known client's callback", async () => {
    const connect = service();
    for (const callback of [
      "http://127.0.0.1:5555/cb",
      "https://claude.ai/api/mcp/auth_callback",
    ]) {
      const { to } = await connect.answer(host, visitor, {
        request: request(callback),
        answer: "allow",
      });
      expect(to).toContain("code=");
    }
  });

  it("sends nobody anywhere without Access, even on Deny or a bad request", async () => {
    const connect = service();
    await expect(
      connect.answer(null, visitor, {
        request: request(unknown),
        answer: "deny",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      connect.answer(null, visitor, {
        request: request(unknown, { response_type: "token" }),
        answer: "allow",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("the token endpoint", () => {
  const callback = "http://127.0.0.1:5555/cb";

  async function codeFor(connect: ReturnType<typeof service>) {
    const authorize = request(callback);
    const { to } = await connect.answer(host, visitor, {
      request: authorize,
      answer: "allow",
    });
    return new URLSearchParams({
      grant_type: "authorization_code",
      code: new URL(to).searchParams.get("code") ?? "",
      code_verifier: verifier,
      client_id: new URLSearchParams(authorize).get("client_id") ?? "",
      redirect_uri: callback,
    });
  }

  it("trades a code once", async () => {
    const used = new Set<string>();
    const connect = service({
      redeemCodeOnce: async (code) => !used.has(code) && !!used.add(code),
    });
    const form = await codeFor(connect);
    expect((await connect.exchange(form)).status).toBe(200);
    const again = await connect.exchange(form);
    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ error: "invalid_grant" });
  });

  it("mints nothing once the holder's Access ended", async () => {
    const connect = service({ verify: async () => null });
    const answer = await connect.exchange(await codeFor(connect));
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: "invalid_grant" });
  });
});
