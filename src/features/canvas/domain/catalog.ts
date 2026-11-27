import { CATALOG, type CatalogTable } from "./data";
import type { GuardCatalog } from "./guard";

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

/** One of the Owner's ready Uploads, as stored. */
export type ReadyUpload = {
  name: string;
  tableName: string;
  profile: UploadProfile | null;
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

/** The shared Tables of Meridia, the same for every Owner. */
export const MERIDIA_CATALOG: readonly CatalogEntry[] =
  CATALOG.map(fromMeridia);

export type OwnerCatalog = {
  tables: CatalogEntry[];
  /** For the Guard: every Table's columns, lower case. */
  guard: GuardCatalog;
  /** The Upload Tables the Sandbox must hold before a Query runs. */
  uploadTables: string[];
};

/** The Owner's Catalog: the Meridia Tables and their own ready Uploads. */
export function ownerCatalog(uploads: readonly ReadyUpload[]): OwnerCatalog {
  const own: CatalogEntry[] = uploads.map((upload) => ({
    name: upload.tableName,
    title: upload.name,
    description: `Uploaded by you: ${upload.name}.`,
    group: "upload",
    grain: "As uploaded",
    rows: upload.profile?.rows ?? 0,
    source: "upload",
    columns: (upload.profile?.columns ?? []).map((column) => ({
      name: column.name,
      type: column.type,
      description:
        column.min !== null && column.max !== null
          ? `${column.min} to ${column.max}; about ${column.distinct ?? "?"} distinct`
          : "",
    })),
  }));
  const tables = [...MERIDIA_CATALOG, ...own];
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
    uploadTables: own.map((table) => table.name),
  };
}
