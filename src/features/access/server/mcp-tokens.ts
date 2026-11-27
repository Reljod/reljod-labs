import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { issuedAfterEpoch } from "../domain/mcp-clients";
import type { Owner } from "../domain/owner";
import { pgCode, sql, UNDEFINED_FUNCTION, UNDEFINED_TABLE } from "./db";

/*
 * Server-side state for the demos' MCP tokens (Client Manager, Harness).
 * The tokens themselves are signed blobs; these two tables are the only
 * state behind them: an Owner's token epoch ("Disconnect all MCP clients")
 * and the authorization codes already redeemed.
 */

/**
 * The table or function is not there yet: the migration
 * (`20261127120000_access_mcp_tokens.sql`) has not been applied. Before it
 * is, nobody can have pressed Disconnect and no code was recorded, so the
 * callers carry on as they did before it existed.
 */
const missing = (error: unknown) => {
  const code = pgCode(error);
  return code === UNDEFINED_TABLE || code === UNDEFINED_FUNCTION;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** When the Owner last disconnected every MCP client (epoch ms), or null. */
const notBeforeOf = cache(async (owner: Owner): Promise<number | null> => {
  try {
    const [row] = await sql()<{ not_before: string }[]>`
      select not_before from access.token_epochs where owner = ${owner}`;
    return row?.not_before ? Date.parse(row.not_before) : null;
  } catch (error) {
    if (missing(error)) return null;
    throw new Error(`Could not load the token epoch: ${messageOf(error)}`, {
      cause: error,
    });
  }
});

/**
 * Whether a token of this Owner, issued at `iat` (epoch seconds; absent on
 * tokens minted before they carried one), still stands. Asked once per
 * request at most. The e2e suite never disconnects, so it costs no lookup.
 */
export async function issuedSinceDisconnect(
  owner: Owner,
  iat: number | undefined,
) {
  if (owner === "e2e") return true;
  return issuedAfterEpoch(iat, await notBeforeOf(owner));
}

/**
 * "Disconnect all MCP clients": every token the Owner was issued up to now
 * (OAuth access and refresh tokens, pasted tokens, chat tokens) stops
 * working on its next use. Tokens carry `iat` in whole seconds, so one minted
 * in the same second as the disconnect is refused too: signing in again works
 * from the next second on.
 */
export async function disconnectMcpClientsOf(owner: Owner) {
  try {
    await sql()`
      insert into access.token_epochs (owner, not_before)
      values (${owner}, ${new Date().toISOString()}::timestamptz)
      on conflict (owner) do update set not_before = excluded.not_before`;
  } catch (error) {
    throw new Error(`Could not disconnect: ${messageOf(error)}`, {
      cause: error,
    });
  }
}

/**
 * Records an authorization code as redeemed. True only the first time, so a
 * code that was seen (in a log, a referrer, a proxy) cannot be traded again
 * within its two minutes.
 */
export async function redeemCodeOnce(code: string, expiresAt: number) {
  try {
    const [row] = await sql()<{ redeemed: boolean | null }[]>`
      select access.redeem_oauth_code(
        p_code_hash => ${createHash("sha256").update(code).digest("base64url")}::text,
        p_expires_at => ${new Date(expiresAt * 1000).toISOString()}::timestamptz
      ) as redeemed`;
    return row?.redeemed === true;
  } catch (error) {
    if (missing(error)) {
      console.error(
        "access.redeem_oauth_code is missing: apply 20261127120000_access_mcp_tokens.sql",
      );
      return true;
    }
    throw new Error(`Could not redeem the code: ${messageOf(error)}`, {
      cause: error,
    });
  }
}
