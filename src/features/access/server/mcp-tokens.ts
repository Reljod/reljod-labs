import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { issuedAfterEpoch } from "../domain/mcp-clients";
import type { Owner } from "../domain/owner";
import { supabase } from "./supabase";

/*
 * Server-side state for the demos' MCP tokens (Client Manager, Harness).
 * The tokens themselves are signed blobs; these two tables are the only
 * state behind them: an Owner's token epoch ("Disconnect all MCP clients")
 * and the authorization codes already redeemed.
 */

type DbError = { code?: string; message: string };

/**
 * The table or function is not there yet: the migration
 * (`20261127120000_access_mcp_tokens.sql`) has not been applied. Before it
 * is, nobody can have pressed Disconnect and no code was recorded, so the
 * callers carry on as they did before it existed.
 */
const missing = (error: DbError) =>
  ["PGRST205", "PGRST202", "42P01", "42883"].includes(error.code ?? "");

/** When the Owner last disconnected every MCP client (epoch ms), or null. */
const notBeforeOf = cache(async (owner: Owner): Promise<number | null> => {
  const { data, error } = await supabase()
    .from("token_epochs")
    .select("not_before")
    .eq("owner", owner)
    .maybeSingle();
  if (error) {
    if (missing(error)) return null;
    throw new Error(`Could not load the token epoch: ${error.message}`);
  }
  const value = (data as { not_before: string } | null)?.not_before;
  return value ? Date.parse(value) : null;
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
 * working on its next use. Signing in again afterwards works at once.
 */
export async function disconnectMcpClientsOf(owner: Owner) {
  const { error } = await supabase()
    .from("token_epochs")
    .upsert(
      { owner, not_before: new Date().toISOString() },
      { onConflict: "owner" },
    );
  if (error) throw new Error(`Could not disconnect: ${error.message}`);
}

/**
 * Records an authorization code as redeemed. True only the first time, so a
 * code that was seen (in a log, a referrer, a proxy) cannot be traded again
 * within its two minutes.
 */
export async function redeemCodeOnce(code: string, expiresAt: number) {
  const { data, error } = await supabase().rpc("redeem_oauth_code", {
    p_code_hash: createHash("sha256").update(code).digest("base64url"),
    p_expires_at: new Date(expiresAt * 1000).toISOString(),
  });
  if (error) {
    if (missing(error)) {
      console.error(
        "access.redeem_oauth_code is missing: apply 20261127120000_access_mcp_tokens.sql",
      );
      return true;
    }
    throw new Error(`Could not redeem the code: ${error.message}`);
  }
  return data === true;
}
