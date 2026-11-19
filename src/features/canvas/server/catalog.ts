import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { CATALOG, type CatalogTable } from "../domain/data";
import type { GuardCatalog } from "../domain/guard";
import { sql } from "./db";

/** A column of an Upload as the Sandbox profiled it. */
export type ProfiledColumn = {
  name: string;
  type: string;
  min: string | number | null;
  max: string | number | null;
  distinct: number | null;
  nullPct: number | null;
};

export type UploadProfile = {
  rows: number;
  columns: ProfiledColumn[];
  sample: (string | number | boolean | null)[][];
};

/** A Table as the Catalog tools describe it. */
export type CatalogEntry = {
  name: string;
  title: string;
  description: string;
  group: string;
  grain: string;
  rows: number;
  /** "meridia" for the shared open data, "upload" for the Owner's own. */
  source: "meridia" | "upload";
  columns: {
    name: string;
    type: string;
    description: string;
    unit?: string;
  }[];
};

const fromMeridia = (table: CatalogTable): CatalogEntry => ({
  name: table.name,
  title: table.title,
  description: table.description,
  group: table.group,
  grain: table.grain,
  rows: table.rows,
  source: "meridia",
  columns: table.columns.map((column) => ({
    name: column.name,
    type: column.type,
    description: column.description,
    ...(column.unit ? { unit: column.unit } : {}),
  })),
});

const MERIDIA = CATALOG.map(fromMeridia);

export type OwnerCatalog = {
  tables: CatalogEntry[];
  /** For the Guard: every Table's columns, lower case. */
  guard: GuardCatalog;
  /** The Upload Tables the Sandbox must hold before a Query runs. */
  uploadTables: string[];
};

/** The Owner's Catalog: the Meridia Tables and their own ready Uploads. */
export async function catalogFor(owner: Owner): Promise<OwnerCatalog> {
  const rows = await sql()<
    { name: string; table_name: string; profile: UploadProfile | null }[]
  >`
    select name, table_name, profile
    from canvas.uploads
    where owner = ${owner} and status = 'ready'
    order by created_at`;
  const uploads: CatalogEntry[] = rows.map((row) => ({
    name: row.table_name,
    title: row.name,
    description: `Uploaded by you: ${row.name}.`,
    group: "upload",
    grain: "As uploaded",
    rows: row.profile?.rows ?? 0,
    source: "upload",
    columns: (row.profile?.columns ?? []).map((column) => ({
      name: column.name,
      type: column.type,
      description:
        column.min !== null && column.max !== null
          ? `${column.min} to ${column.max}; about ${column.distinct ?? "?"} distinct`
          : "",
    })),
  }));
  const tables = [...MERIDIA, ...uploads];
  return {
    tables,
    guard: {
      tables: Object.fromEntries(
        tables.map((table) => [
          table.name.toLowerCase(),
          table.columns.map((column) => column.name.toLowerCase()),
        ]),
      ),
    },
    uploadTables: uploads.map((table) => table.name),
  };
}

/** The shared Tables alone, for pages that need no Owner. */
export function meridiaCatalog() {
  return MERIDIA;
}
