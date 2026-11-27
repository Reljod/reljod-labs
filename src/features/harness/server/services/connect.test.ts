import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../env", () => ({
  env: { rateLimitSalt: () => "test-salt-0123456789" },
}));

import { InvalidError } from "@/platform/errors";
import {
  pkceChallenge,
  readHarnessToken,
  registerClient,
} from "../../domain/oauth";
import type { Staff } from "../../domain/staff";
import { createConnectService } from "./connect";

const SECRET = "test-salt-0123456789";
const keisha: Staff = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "keisha",
  name: "Keisha",
  title: "",
  role: "user",
  initials: "K",
};
const caller = {
  access: { kind: "e2e" as const },
  owner: "e2e" as const,
  staff: keisha,
  visitor: { hash: "v", trusted: false },
};

function setup(strict: () => Promise<void> = async () => {}) {
  const audited: string[] = [];
  const service = createConnectService({
    // Keisha is the only Staff member of this Workspace.
    staff: {
      owned: async (owner, id) =>
        owner === "e2e" && id === keisha.id ? keisha : null,
    },
    audit: {
      record: async () => 1,
      strict: async (input) => {
        await strict();
        audited.push(input.action);
      },
    },
    secret: () => SECRET,
    now: Date.now,
  });
  return { service, audited };
}

describe("a pasted MCP token", () => {
  it("is handed over only after mcp.connected is written, and carries iat", async () => {
    const { service, audited } = setup();
    const before = Math.floor(Date.now() / 1000);
    const minted = await service.mintToken(caller, "https://labs.test");
    expect(audited).toEqual(["mcp.connected"]);
    const claims = readHarnessToken(minted.token, SECRET);
    expect(claims?.owner).toBe("e2e");
    expect(claims?.staffId).toBe(keisha.id);
    expect(claims?.iat).toBeGreaterThanOrEqual(before);
  });

  it("is not handed over when its Audit event cannot be written", async () => {
    const { service } = setup(async () => {
      throw new Error("audit insert failed");
    });
    await expect(
      service.mintToken(caller, "https://labs.test"),
    ).rejects.toThrow(/audit insert failed/);
  });
});

/** A request from a registered client, to `callback` (an unknown https host unless said). */
function authorization(callback = "https://unknown.example/cb") {
  const registered = registerClient(
    { client_name: "Some app", redirect_uris: [callback] },
    SECRET,
    Date.now(),
  );
  if (!registered.ok) throw new Error(registered.error_description);
  return new URLSearchParams({
    client_id: registered.registration.client_id,
    redirect_uri: callback,
    response_type: "code",
    code_challenge: pkceChallenge("a".repeat(64)),
    code_challenge_method: "S256",
    state: "xyz",
  }).toString();
}

describe("the consent page's answer", () => {
  it("needs 'I trust' ticked for an unknown callback, and mints nothing before", async () => {
    const { service, audited } = setup();
    const request = authorization();
    await expect(
      service.consent(caller, {
        request,
        answer: "allow",
        staffId: keisha.id,
        trustHost: null,
      }),
    ).rejects.toThrow(/I trust unknown\.example/);
    expect(audited).toEqual([]);
    const allowed = await service.consent(caller, {
      request,
      answer: "allow",
      staffId: keisha.id,
      trustHost: "unknown.example",
    });
    expect(allowed.redirect).toMatch(/^https:\/\/unknown\.example\/cb\?code=/);
    expect(audited).toEqual(["mcp.connected"]);
  });

  it("acts only as a Staff member of the caller's own Workspace", async () => {
    const { service, audited } = setup();
    await expect(
      service.consent(caller, {
        request: authorization(),
        answer: "allow",
        staffId: "99999999-9999-4999-8999-999999999999",
        trustHost: "unknown.example",
      }),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(audited).toEqual([]);
  });

  it("sends a Deny back to the client as access_denied", async () => {
    const { service } = setup();
    const denied = await service.consent(caller, {
      request: authorization(),
      answer: "deny",
      staffId: keisha.id,
      trustHost: null,
    });
    expect(denied.redirect).toContain("error=access_denied");
  });

  it("refuses an authorization request it cannot read, and redirects nobody", async () => {
    const { service, audited } = setup();
    await expect(
      service.consent(caller, {
        request: "client_id=nobody",
        answer: "allow",
        staffId: keisha.id,
        trustHost: null,
      }),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(audited).toEqual([]);
  });
});
