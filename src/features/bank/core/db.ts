import postgres from "postgres";

/**
 * The bank's Postgres pool. Set up for Supabase's transaction pooler like
 * the Harness's (prepared statements off, one query per connection at a
 * time), and with three type choices of its own:
 *   - bigint columns (money, entry ids) come back as numbers: amounts are
 *     capped far below 2^53;
 *   - `date` columns stay "YYYY-MM-DD" strings (bank dates, never a JS Date
 *     in someone's local time);
 *   - `timestamptz` columns come back as ISO strings.
 * Column names come back camelCased.
 */
export function makePool(
  url: string,
  max = 4,
): postgres.Sql<{ bigint: number; date: string; timestamptz: string }> {
  return postgres(url, {
    prepare: false,
    max_pipeline: 1,
    max,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number) => String(value),
        parse: (value: string) => Number(value),
      },
      date: {
        to: 1082,
        from: [1082],
        serialize: (value: string) => value,
        parse: (value: string) => value,
      },
      timestamptz: {
        to: 1184,
        from: [1184],
        serialize: (value: string | Date) =>
          value instanceof Date ? value.toISOString() : value,
        parse: (value: string) => new Date(value).toISOString(),
      },
    },
    transform: { column: { from: postgres.toCamel }, undefined: null },
  });
}

type Types = { bigint: number; date: string; timestamptz: string };
export type Pool = postgres.Sql<Types>;
export type Tx = postgres.TransactionSql<Types>;

/** The pool, or a transaction on it: what a function takes when it may run inside either. */
export type Db = Pool | Tx;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A value for a `jsonb` column or argument. */
export function jsonb(db: Db, value: unknown) {
  return db.json(value as never);
}
