import "server-only";
import { db } from "@/server/postgres";
import type { UploadProfile } from "../domain/catalog";
import type { UploadRepository } from "./ports";

/** The Owner's ready Uploads in Postgres: the part of their Catalog that is theirs alone. */
export const uploadRepository: UploadRepository = {
  async ready(owner) {
    const rows = await db()<
      { name: string; table_name: string; profile: UploadProfile | null }[]
    >`
      select name, table_name, profile
      from canvas.uploads
      where owner = ${owner} and status = 'ready'
      order by created_at`;
    return rows.map((row) => ({
      name: row.name,
      tableName: row.table_name,
      profile: row.profile,
    }));
  },
};
