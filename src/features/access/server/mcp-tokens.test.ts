import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  epochs: new Map<string, string>(),
  codes: new Set<string>(),
  epochReads: 0,
  error: null as { code?: string; message: string } | null,
}));

vi.mock("server-only", () => ({}));
/* A stand-in for the postgres.js tagged template over the two tables:
   it answers by which statement it is handed. */
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$");
    if (db.error)
      throw Object.assign(new Error(db.error.message), {
        code: db.error.code,
      });
    if (text.includes("select not_before from access.token_epochs")) {
      db.epochReads += 1;
      const value = db.epochs.get(values[0] as string);
      return value ? [{ not_before: value }] : [];
    }
    if (text.includes("insert into access.token_epochs")) {
      db.epochs.set(values[0] as string, values[1] as string);
      return [];
    }
    if (text.includes("access.redeem_oauth_code(")) {
      const hash = values[0] as string;
      if (db.codes.has(hash)) return [{ redeemed: false }];
      db.codes.add(hash);
      return [{ redeemed: true }];
    }
    throw new Error(`Unexpected statement: ${text}`);
  };
  return { ...actual, sql: () => tag };
});

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
    db.error = { code: "42P01", message: "no table" };
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
