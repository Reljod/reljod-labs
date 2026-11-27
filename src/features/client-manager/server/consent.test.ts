import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError } from "@/features/access/server/errors";
import type { Access } from "@/features/access/server/gate";
import { InvalidError, UnauthorizedError } from "@/platform/errors";
import { type Grant, registerClient } from "../domain/oauth";
import { createConsentService } from "./consent";

const host: Access = {
  kind: "host",
  userId: "4b7f0c1e-0000-4000-8000-000000000001",
  email: "host@example.com",
  name: "",
};

const grant: Grant = {
  kind: "host",
  owner: "host:4b7f0c1e-0000-4000-8000-000000000001",
  visitor: "v",
  email: "host@example.com",
  iat: 1,
  until: Math.floor(Date.now() / 1000) + 3600,
};

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

function service(currentGrant: () => Promise<Grant> = async () => grant) {
  return createConsentService({
    secret: () => "salt",
    grant: currentGrant,
    now: Date.now,
  });
}

describe("the consent service", () => {
  const unknown = "https://evil.example/cb";

  it("allows an unknown callback only once its host is ticked", async () => {
    const consent = service();
    await expect(
      consent.answer(host, { request: request(unknown), answer: "allow" }),
    ).rejects.toThrow(/I trust evil\.example/);
    await expect(
      consent.answer(host, {
        request: request(unknown),
        answer: "allow",
        trustHost: "other.example",
      }),
    ).rejects.toBeInstanceOf(InvalidError);
    const { to } = await consent.answer(host, {
      request: request(unknown),
      answer: "allow",
      trustHost: "evil.example",
    });
    expect(to).toMatch(/^https:\/\/evil\.example\/cb\?code=/);
  });

  it("needs no tick for a loopback or known client's callback", async () => {
    const consent = service();
    for (const callback of [
      "http://127.0.0.1:5555/cb",
      "https://claude.ai/api/mcp/auth_callback",
    ]) {
      const { to } = await consent.answer(host, {
        request: request(callback),
        answer: "allow",
      });
      expect(to).toContain("code=");
    }
  });

  it("sends nobody anywhere without Access, even on Deny or a bad request", async () => {
    const consent = service();
    await expect(
      consent.answer(null, { request: request(unknown), answer: "deny" }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      consent.answer(null, {
        request: request(unknown, { response_type: "token" }),
        answer: "allow",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("mints no code once the Access ended between the page and the click", async () => {
    const consent = service(async () => {
      throw new AccessDeniedError();
    });
    await expect(
      consent.answer(host, {
        request: request("http://127.0.0.1:5555/cb"),
        answer: "allow",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
