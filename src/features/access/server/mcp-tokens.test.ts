import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  epochs: new Map<string, string>(),
  codes: new Set<string>(),
  epochReads: 0,
  error: null as { code?: string; message: string } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({
  supabase: () => ({
    from: (table: string) => {
      if (table !== "token_epochs") throw new Error(table);
      return {
        select: () => ({
          eq: (_column: string, owner: string) => ({
            maybeSingle: async () => {
              db.epochReads += 1;
              if (db.error) return { data: null, error: db.error };
              const value = db.epochs.get(owner);
              return { data: value ? { not_before: value } : null };
            },
          }),
        }),
        upsert: async (row: { owner: string; not_before: string }) => {
          db.epochs.set(row.owner, row.not_before);
          return { error: null };
        },
      };
    },
    rpc: async (
      name: string,
      args: { p_code_hash: string; p_expires_at: string },
    ) => {
      if (name !== "redeem_oauth_code") throw new Error(name);
      if (db.error) return { data: null, error: db.error };
      if (db.codes.has(args.p_code_hash)) return { data: false, error: null };
      db.codes.add(args.p_code_hash);
      return { data: true, error: null };
    },
  }),
}));

import {
  disconnectMcpClientsOf,
  issuedSinceDisconnect,
  redeemCodeOnce,
} from "./mcp-tokens";

const HOST = "host:4b7f0c1e-0000-4000-8000-000000000001" as const;
const OTHER = "host:4b7f0c1e-0000-4000-8000-000000000002" as const;
const seconds = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  db.epochs.clear();
  db.codes.clear();
  db.epochReads = 0;
  db.error = null;
});

describe("Disconnect all MCP clients", () => {
  it("refuses the Owner's tokens issued before it, and only theirs", async () => {
    const before = seconds() - 5;
    expect(await issuedSinceDisconnect(HOST, before)).toBe(true);
    await disconnectMcpClientsOf(HOST);
    expect(await issuedSinceDisconnect(HOST, before)).toBe(false);
    expect(await issuedSinceDisconnect(HOST, undefined)).toBe(false);
    expect(await issuedSinceDisconnect(HOST, seconds() + 1)).toBe(true);
    expect(await issuedSinceDisconnect(OTHER, before)).toBe(true);
  });

  it("never asks about the e2e suite", async () => {
    expect(await issuedSinceDisconnect("e2e", undefined)).toBe(true);
    expect(db.epochReads).toBe(0);
  });

  it("treats a missing table as nothing disconnected, and fails closed on any other error", async () => {
    db.error = { code: "PGRST205", message: "no table" };
    expect(await issuedSinceDisconnect(HOST, undefined)).toBe(true);
    db.error = { code: "08006", message: "connection lost" };
    await expect(issuedSinceDisconnect(OTHER, undefined)).rejects.toThrow(
      /token epoch/,
    );
  });
});

describe("an authorization code", () => {
  it("is redeemed once", async () => {
    const exp = seconds() + 120;
    expect(await redeemCodeOnce("cmo_code", exp)).toBe(true);
    expect(await redeemCodeOnce("cmo_code", exp)).toBe(false);
    expect(await redeemCodeOnce("cmo_other", exp)).toBe(true);
  });

  it("fails closed when the database errors", async () => {
    db.error = { code: "08006", message: "connection lost" };
    await expect(redeemCodeOnce("cmo_code", seconds())).rejects.toThrow(
      /redeem the code/,
    );
  });
});
