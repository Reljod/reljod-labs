import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../domain/guest-pass";
import type { Owner } from "../domain/owner";

/**
 * The Access repository, MCP token state and Storage purge queue against a
 * real Postgres with the access migrations applied (`pnpm test:demo-db`).
 * Skipped unless DEMO_TEST_DATABASE_URL is set. Every row here hangs off a
 * random Host, visitor or bucket, and only those rows are deleted afterwards.
 */
const url = process.env.DEMO_TEST_DATABASE_URL;

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: vi.fn() }));

const HOST = randomUUID();
const GUEST_A = randomUUID();
const GUEST_B = randomUUID();
const GUEST_C = randomUUID();
const USERS = [HOST, GUEST_A, GUEST_B, GUEST_C];
const VISITOR = `access-db-test-${randomUUID()}`;
const BUCKET = `access-db-test-${randomUUID()}`;
const OWNER = `host:${HOST}` as Owner;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?\+00:00$/;

describe.skipIf(!url)("Access on Postgres", () => {
  let repo: typeof import("./repository");
  let tokens: typeof import("./mcp-tokens");
  let purge: typeof import("./storage-purge");
  let sql: typeof import("./db").sql;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    repo = await import("./repository");
    tokens = await import("./mcp-tokens");
    purge = await import("./storage-purge");
    ({ sql } = await import("./db"));
    for (const id of USERS)
      await sql()`insert into auth.users (id, is_anonymous) values (${id}, ${id !== HOST})`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql()`delete from access.attempts where visitor_hash like ${`${VISITOR}%`}`;
    await sql()`delete from access.token_epochs where owner = ${OWNER}`;
    await sql()`delete from access.storage_purge where bucket = ${BUCKET}`;
    await sql()`delete from storage.objects where bucket_id = ${BUCKET}`;
    // Guest passes and sessions cascade from their Auth users.
    await sql()`delete from auth.users where id = any(${USERS}::uuid[])`;
    await sql().end();
  });

  const newPass = (code: string, maxDevices = 2, days = 1) =>
    repo.insertGuestPass({
      label: `Pass ${code}`,
      codeHash: `${VISITOR}-${code}`,
      createdBy: HOST,
      expiresAt: new Date(Date.now() + days * 86_400_000),
      maxDevices,
    });

  it("creates a pass, loads it by id and lists it with its device count", async () => {
    const pass = await newPass("one");
    expect(pass).toMatchObject({
      label: "Pass one",
      max_devices: 2,
      revoked_at: null,
      renewed_at: null,
      deleted_at: null,
    });
    expect(pass.created_at).toMatch(ISO);
    expect(pass.expires_at).toMatch(ISO);
    expect(await repo.guestPassById(pass.id)).toEqual(pass);
    expect(await repo.guestPassById(randomUUID())).toBeNull();

    const listed = (await repo.listGuestPasses()).find((p) => p.id === pass.id);
    expect(listed).toEqual({ ...pass, devices: 0 });
    expect(await repo.countLivePasses()).toBeGreaterThanOrEqual(1);
  });

  it("redeems a code onto a device, up to the pass's device cap", async () => {
    const pass = await newPass("two", 2);
    const code = `${VISITOR}-two`;
    expect(await repo.codeLooksGood(code, GUEST_A)).toBe(true);
    expect(await repo.codeLooksGood(`${code}-wrong`, GUEST_A)).toBe(false);

    const redeemed = await repo.redeem({
      codeHash: code,
      userId: GUEST_A,
      visitorHash: VISITOR,
    });
    expect(redeemed?.passId).toBe(pass.id);
    expect(redeemed?.expiresAt).toMatch(ISO);
    expect((await repo.guestPassOf(GUEST_A))?.id).toBe(pass.id);
    expect(await repo.guestPassOf(GUEST_C)).toBeNull();

    // The same device again does not take a second place.
    expect(await repo.codeLooksGood(code, GUEST_A)).toBe(true);
    await repo.redeem({
      codeHash: code,
      userId: GUEST_B,
      visitorHash: VISITOR,
    });
    expect(await repo.codeLooksGood(code, GUEST_C)).toBe(false);
    expect(await repo.codeLooksGood(code, null)).toBe(false);
    expect(
      await repo.redeem({
        codeHash: code,
        userId: GUEST_C,
        visitorHash: VISITOR,
      }),
    ).toBeNull();
    const listed = (await repo.listGuestPasses()).find((p) => p.id === pass.id);
    expect(listed?.devices).toBe(2);

    // Ending one Guest session frees its place.
    await repo.endGuestSession(GUEST_B);
    expect(await repo.guestPassOf(GUEST_B)).toBeNull();
    expect(await repo.codeLooksGood(code, GUEST_C)).toBe(true);
  });

  it("revokes, extends, re-codes, deletes and restores a pass", async () => {
    const pass = await newPass("three", 3);
    const code = `${VISITOR}-three`;
    await repo.redeem({
      codeHash: code,
      userId: GUEST_C,
      visitorHash: VISITOR,
    });

    await repo.revokeGuestPass(pass.id);
    const revoked = await repo.guestPassById(pass.id);
    expect(revoked?.revoked_at).toMatch(ISO);
    expect(await repo.codeLooksGood(code, null)).toBe(false);
    // A second revoke keeps the first time.
    await repo.revokeGuestPass(pass.id);
    expect((await repo.guestPassById(pass.id))?.revoked_at).toBe(
      revoked?.revoked_at,
    );

    const until = new Date(Date.now() + 3 * 86_400_000);
    const now = new Date();
    await repo.extendGuestPass(pass.id, until, now);
    const extended = await repo.guestPassById(pass.id);
    expect(extended?.revoked_at).toBeNull();
    expect(Date.parse(extended?.expires_at ?? "")).toBe(until.getTime());
    expect(Date.parse(extended?.renewed_at ?? "")).toBe(now.getTime());

    // A new code signs every device out, in the same step.
    await repo.replaceGuestCode(pass.id, `${VISITOR}-three-new`);
    expect(await repo.guestPassOf(GUEST_C)).toBeNull();
    expect(await repo.codeLooksGood(code, null)).toBe(false);
    expect(await repo.codeLooksGood(`${VISITOR}-three-new`, null)).toBe(true);

    await repo.markGuestPassDeleted(pass.id);
    expect((await repo.guestPassById(pass.id))?.deleted_at).toMatch(ISO);
    expect(await repo.codeLooksGood(`${VISITOR}-three-new`, null)).toBe(false);
    // A deleted pass is neither extended nor re-coded.
    await repo.extendGuestPass(pass.id, new Date(Date.now() + 86_400_000), now);
    expect((await repo.guestPassById(pass.id))?.expires_at).toBe(
      extended?.expires_at,
    );
    await repo.replaceGuestCode(pass.id, `${VISITOR}-three-later`);
    expect(await repo.codeLooksGood(`${VISITOR}-three-later`, null)).toBe(
      false,
    );

    await repo.restoreGuestPass(pass.id);
    expect((await repo.guestPassById(pass.id))?.deleted_at).toBeNull();
    expect(await repo.codeLooksGood(`${VISITOR}-three-new`, null)).toBe(true);
  });

  it("takes attempts until the visitor's cap, and settles or releases them", async () => {
    const visitor = `${VISITOR}-door`;
    const ids: number[] = [];
    for (let i = 0; i < LIMITS.failedAttempts; i++) {
      const id = await repo.takeAttempt(visitor, "sign_in");
      expect(typeof id).toBe("number");
      ids.push(id as number);
    }
    expect(await repo.takeAttempt(visitor, "sign_in")).toBeNull();

    // A settled try no longer counts, and a released one is gone.
    await repo.settleAttempt(ids[0] as number);
    await repo.releaseAttempt(ids[1] as number);
    const rows = await sql()<{ id: number; succeeded: boolean }[]>`
      select id, succeeded from access.attempts
      where visitor_hash = ${visitor} order by id`;
    expect(rows.map((row) => row.id)).not.toContain(ids[1]);
    expect(rows.find((row) => row.id === ids[0])?.succeeded).toBe(true);
    expect(await repo.takeAttempt(visitor, "sign_in")).toEqual(
      expect.any(Number),
    );
    expect(await repo.takeAttempt(visitor, "sign_in")).toEqual(
      expect.any(Number),
    );
    expect(await repo.takeAttempt(visitor, "sign_in")).toBeNull();
    // Another visitor is untouched.
    expect(await repo.takeAttempt(`${VISITOR}-other`, "sign_in")).toEqual(
      expect.any(Number),
    );
  });

  it("keeps the Owner's MCP token epoch, and redeems a code only once", async () => {
    const before = Math.floor(Date.now() / 1000) - 5;
    expect(await tokens.issuedSinceDisconnect(OWNER, before)).toBe(true);
    await tokens.disconnectMcpClientsOf(OWNER);
    expect(await tokens.issuedSinceDisconnect(OWNER, before)).toBe(false);
    // Disconnecting again moves the epoch on (the upsert).
    await tokens.disconnectMcpClientsOf(OWNER);
    const [epoch] = await sql()<{ count: number }[]>`
      select count(*)::int as count from access.token_epochs where owner = ${OWNER}`;
    expect(epoch?.count).toBe(1);
    expect(
      await tokens.issuedSinceDisconnect(
        OWNER,
        Math.floor(Date.now() / 1000) + 2,
      ),
    ).toBe(true);

    const code = `cmo_${randomUUID()}`;
    const exp = Math.floor(Date.now() / 1000) + 120;
    expect(await tokens.redeemCodeOnce(code, exp)).toBe(true);
    expect(await tokens.redeemCodeOnce(code, exp)).toBe(false);
  });

  it("reads the Storage purge queue: only objects still stored", async () => {
    await sql()`
      insert into storage.objects (bucket_id, name) values
        (${BUCKET}, 'host/owner-1/a.pdf'), (${BUCKET}, 'host/owner-1/b.pdf')`;
    await sql()`
      insert into access.storage_purge (bucket, prefix) values
        (${BUCKET}, 'host/owner-1/'), (${BUCKET}, 'host/owner-2/')`;
    const batch = (await purge.storagePurgeDeps.next()).filter(
      (object) => object.bucket === BUCKET,
    );
    expect(batch).toEqual([
      { bucket: BUCKET, name: "host/owner-1/a.pdf" },
      { bucket: BUCKET, name: "host/owner-1/b.pdf" },
    ]);
    // A prefix with nothing left under it leaves the queue.
    const left = await sql()<{ prefix: string }[]>`
      select prefix from access.storage_purge where bucket = ${BUCKET}`;
    expect(left.map((row) => row.prefix)).toEqual(["host/owner-1/"]);
  });
});
