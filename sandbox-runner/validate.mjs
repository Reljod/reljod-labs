// Checks on everything a request can name. Pure functions, no I/O.

export const LIMITS = Object.freeze({
  bodyBytes: 512 * 1024,
  fileBytes: 256 * 1024,
  maxFiles: 200,
  pathBytes: 200,
  outputBytes: 64 * 1024,
  runTimeoutMs: 60_000,
  minTimeoutMs: 100,
  commandArgs: 64,
  commandBytes: 64 * 1024,
});

/** Lower-case RFC 4122 UUID, versions 1 to 8. */
export const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const CONTAINER_PREFIX = "harness-sbx-";
export const CONTAINER_NAME =
  /^harness-sbx-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isSessionId(value) {
  return typeof value === "string" && SESSION_ID.test(value);
}

/** The container of a Session. Throws on anything that is not a Session id. */
export function containerName(sid) {
  if (!isSessionId(sid)) throw new Error("not a session id");
  return CONTAINER_PREFIX + sid;
}

/** True when the text has a NUL, another C0 control character or DEL. */
function hasControlCharacter(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A file path inside the workdir: relative, no `..`, no control characters, no
 * backslash, at most 200 bytes. `a//b` and `./a` are tidied; a trailing slash is refused.
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function normalizePath(input) {
  if (typeof input !== "string")
    return { ok: false, reason: "path must be a string" };
  if (input.length === 0) return { ok: false, reason: "path is empty" };
  if (Buffer.byteLength(input, "utf8") > LIMITS.pathBytes) {
    return {
      ok: false,
      reason: `path is longer than ${LIMITS.pathBytes} bytes`,
    };
  }
  if (hasControlCharacter(input))
    return { ok: false, reason: "path has a control character" };
  if (input.includes("\\"))
    return { ok: false, reason: "path has a backslash" };
  if (input.startsWith("/"))
    return { ok: false, reason: "path must be relative" };
  if (input.endsWith("/"))
    return { ok: false, reason: "path must name a file" };
  const segments = [];
  for (const segment of input.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..")
      return { ok: false, reason: "path must not contain .." };
    segments.push(segment);
  }
  if (segments.length === 0)
    return { ok: false, reason: "path must name a file" };
  return { ok: true, path: segments.join("/") };
}

/**
 * A command: an argv array run as is, or a string run under `sh -lc` in the container.
 * @returns {{ ok: true, argv: string[] } | { ok: false, reason: string }}
 */
export function normalizeCommand(input) {
  if (typeof input === "string") {
    if (input.trim() === "") return { ok: false, reason: "command is empty" };
    if (input.includes("\u0000"))
      return { ok: false, reason: "command has a NUL byte" };
    if (Buffer.byteLength(input, "utf8") > LIMITS.commandBytes) {
      return { ok: false, reason: "command is too long" };
    }
    return { ok: true, argv: ["sh", "-lc", input] };
  }
  if (!Array.isArray(input))
    return {
      ok: false,
      reason: "command must be a string or an array of strings",
    };
  if (input.length === 0 || input.length > LIMITS.commandArgs) {
    return {
      ok: false,
      reason: `command must have 1 to ${LIMITS.commandArgs} arguments`,
    };
  }
  let bytes = 0;
  for (const arg of input) {
    if (typeof arg !== "string")
      return {
        ok: false,
        reason: "command must be a string or an array of strings",
      };
    if (arg.includes("\u0000"))
      return { ok: false, reason: "command has a NUL byte" };
    bytes += Buffer.byteLength(arg, "utf8");
  }
  if (input[0] === "") return { ok: false, reason: "command is empty" };
  if (bytes > LIMITS.commandBytes)
    return { ok: false, reason: "command is too long" };
  return { ok: true, argv: [...input] };
}

/** @returns {{ ok: true, timeoutMs: number } | { ok: false, reason: string }} */
export function normalizeTimeout(input) {
  if (input === undefined || input === null)
    return { ok: true, timeoutMs: LIMITS.runTimeoutMs };
  if (
    !Number.isInteger(input) ||
    input < LIMITS.minTimeoutMs ||
    input > LIMITS.runTimeoutMs
  ) {
    return {
      ok: false,
      reason: `timeoutMs must be an integer from ${LIMITS.minTimeoutMs} to ${LIMITS.runTimeoutMs}`,
    };
  }
  return { ok: true, timeoutMs: input };
}
