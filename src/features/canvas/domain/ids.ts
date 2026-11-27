const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check an id from a URL or a tool call before it reaches a `uuid` column. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
