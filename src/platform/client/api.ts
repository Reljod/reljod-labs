/**
 * The one way browser code talks to a demo's REST routes. Reads are GETs
 * (parallel, abortable, revalidated by ETag); writes are POST, PUT, PATCH or
 * DELETE with a JSON body. Every failure arrives as an `ApiError` carrying
 * the message the route chose to show, so a component never parses a
 * response itself.
 */

const DENIED =
  "Your access has ended. Sign in again, or ask your Host for a new Guest code.";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The rest of the error body (field errors, a retry hint). */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The error a failed response carries. The body is read as text and parsed
 * only if it is JSON: the proxy's 401 is plain text.
 */
export async function errorOf(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object")
      body = parsed as Record<string, unknown>;
  } catch {}
  const message =
    typeof body.error === "string"
      ? body.error
      : response.status === 401
        ? text.trim() || DENIED
        : response.status === 429
          ? "That's the limit for now. Try again soon."
          : `Request failed (${response.status})`;
  return new ApiError(response.status, message, body);
}

type Query = Record<string, string | number | boolean | null | undefined>;

/** `path?key=value`, leaving out keys that are null or undefined. */
export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/** A GET read. Throws an ApiError on any non-2xx answer. */
export async function getJson<T>(
  path: string,
  options: { query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(withQuery(path, options.query), {
    signal: options.signal,
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await errorOf(response);
  return (await response.json()) as T;
}

type Method = "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * A write. Resolves with the route's JSON answer (undefined for a 204).
 * Throws an ApiError on any non-2xx answer.
 */
export async function send<T = void>(
  method: Method,
  path: string,
  body?: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    signal: options.signal,
    headers:
      body === undefined
        ? { accept: "application/json" }
        : { accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await errorOf(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A write result for a button that shows what happened where it was clicked. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** Runs a write and turns an ApiError (or a dropped connection) into an Outcome. */
export async function attempt<T>(write: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await write() };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    return {
      ok: false,
      error:
        error instanceof ApiError
          ? error.message
          : "Couldn't reach the server. Check your connection and try again.",
    };
  }
}

/**
 * Reads an NDJSON stream line by line, calling `onEvent` for each object.
 * Resolves when the stream ends.
 */
export async function readNdjson<E>(
  response: Response,
  onEvent: (event: E) => void,
): Promise<void> {
  if (!response.ok || !response.body) throw await errorOf(response);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const emit = (line: string) => {
    if (line.trim()) onEvent(JSON.parse(line) as E);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) emit(line);
  }
  emit(buffer);
}

/** GETs an NDJSON stream (a Run's events) and hands each line to `onEvent`. */
export async function followNdjson<E>(
  path: string,
  onEvent: (event: E) => void,
  options: { query?: Query; signal?: AbortSignal } = {},
): Promise<void> {
  const response = await fetch(withQuery(path, options.query), {
    signal: options.signal,
    headers: { accept: "application/x-ndjson" },
  });
  await readNdjson(response, onEvent);
}

/** POSTs JSON and streams the NDJSON answer to `onEvent`. */
export async function streamJson<E>(
  path: string,
  body: unknown,
  onEvent: (event: E) => void,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await readNdjson(response, onEvent);
}
