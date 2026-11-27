/**
 * What the MCP servers of the demos (Client Manager, Harness) share about the
 * outside clients that sign in to them with OAuth: whose callback a consent
 * page may trust, and when a Host's tokens stop working. No Node imports, so
 * consent pages and their client components can use it.
 */

/** A CLI's own callback on this machine (RFC 8252). */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

/**
 * Hosted MCP clients whose OAuth callback lives on these exact hosts. Anyone
 * can register a client with any https callback and any name, so a consent
 * page warns before it sends a code anywhere else. Add a host only for a
 * client people really connect, by its exact callback host.
 */
export const KNOWN_CLIENT_HOSTS: ReadonlySet<string> = new Set([
  "claude.ai",
  "claude.com",
  "chatgpt.com",
]);

/**
 * How far a consent page may trust where it sends the person back to:
 * `local` (http on this machine), `known` (a hosted client on the list), or
 * `unknown` (any other https host, chosen by whoever registered the client).
 */
export type CallbackTrust = "local" | "known" | "unknown";

export function callbackTrust(uri: string): CallbackTrust {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "unknown";
  }
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
    return "local";
  if (url.protocol === "https:" && KNOWN_CLIENT_HOSTS.has(url.hostname))
    return "known";
  return "unknown";
}

/**
 * Whether the consent form vouched for an unknown callback: the person ticked
 * "I trust <host>", and the form names the host it showed them. Checked on
 * the server, so a forged form cannot skip it.
 */
export function callbackVouched(uri: string, vouched: unknown) {
  if (callbackTrust(uri) !== "unknown") return true;
  try {
    return typeof vouched === "string" && vouched === new URL(uri).host;
  } catch {
    return false;
  }
}

/**
 * Whether a token still stands against its Owner's token epoch. Once the
 * Owner pressed "Disconnect all MCP clients" at `notBefore` (epoch ms), a
 * token issued that second or earlier is refused, and so is one with no
 * `iat` (minted before tokens carried one). With no epoch every unexpired
 * token stands, so tokens already handed out keep working until then.
 */
export function issuedAfterEpoch(
  iat: number | undefined,
  notBefore: number | null,
) {
  if (notBefore === null) return true;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return false;
  return iat > Math.floor(notBefore / 1000);
}
