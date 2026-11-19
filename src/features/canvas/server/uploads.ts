import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { LIMITS } from "../domain/limits";
import { uploadTableName } from "../domain/upload";
import type { Caller } from "./caller";
import type { UploadProfile } from "./catalog";
import { isUuid, jsonb, sql } from "./db";
import { BUCKET } from "./env";
import { InvalidError, LimitError, NotFoundError, StateError } from "./errors";
import { takeRate } from "./rate";
import { putInbox, runJob } from "./sandbox/session";
import { storage } from "./supabase";
import { trail, trailIn } from "./trail";

/*
 * Uploads (GLOSSARY): a person's own CSV or Parquet file. The browser PUTs
 * it to a signed URL in the private bucket; the server then copies it into
 * the Owner's Sandbox, where DuckDB reads and profiles it. It becomes a
 * Table in that Owner's Catalog only, and never leaves their Sandbox.
 */

export type Upload = {
  id: string;
  name: string;
  tableName: string;
  format: "csv" | "parquet";
  bytes: number;
  status: "pending" | "ready" | "failed";
  profile: UploadProfile | null;
  error: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  name: string;
  table_name: string;
  format: "csv" | "parquet";
  bytes: number;
  storage_path: string;
  status: Upload["status"];
  profile: UploadProfile | null;
  error: string | null;
  created_at: Date;
};

const uploadOf = (row: Row): Upload => ({
  id: row.id,
  name: row.name,
  tableName: row.table_name,
  format: row.format,
  bytes: Number(row.bytes),
  status: row.status,
  profile: row.profile,
  error: row.error,
  createdAt: row.created_at.toISOString(),
});

/** A stable, non-reversible folder per Owner: no raw input reaches a storage key. */
const ownerFolder = (owner: string) =>
  createHash("sha256").update(`canvas:${owner}`).digest("hex").slice(0, 32);

export async function listUploads(caller: Pick<Caller, "owner">) {
  const rows = await sql()<Row[]>`
    select * from canvas.uploads
    where owner = ${caller.owner} and status <> 'pending'
    order by created_at desc
    limit ${LIMITS.uploadsPerOwner * 2}`;
  return rows.map(uploadOf);
}

async function owned(caller: Pick<Caller, "owner">, id: string) {
  if (!isUuid(id)) throw new NotFoundError("No such Upload.");
  const [row] = await sql()<Row[]>`
    select * from canvas.uploads where id = ${id} and owner = ${caller.owner}`;
  if (!row) throw new NotFoundError("No such Upload.");
  return row;
}

/** Opens an Upload: a row and a signed URL the browser PUTs the file to. */
export async function openUpload(
  caller: Caller,
  input: { name: unknown; bytes: unknown },
) {
  const name = String(input.name ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .trim()
    .slice(0, 120);
  const format = /\.parquet$/i.test(name)
    ? "parquet"
    : /\.csv$/i.test(name)
      ? "csv"
      : null;
  if (!name || !format)
    throw new InvalidError("Upload a .csv or a .parquet file.");
  const bytes = Math.trunc(Number(input.bytes));
  if (!(bytes > 0))
    throw new InvalidError("The file is empty.");
  if (bytes > LIMITS.uploadBytes)
    throw new LimitError(
      `An Upload may be at most ${LIMITS.uploadBytes / 1024 / 1024} MB.`,
    );
  const db = sql();
  const existing = await db<{ table_name: string; status: string }[]>`
    select table_name, status from canvas.uploads where owner = ${caller.owner}`;
  if (
    existing.filter((row) => row.status === "ready").length >=
    LIMITS.uploadsPerOwner
  )
    throw new LimitError(
      `You can keep ${LIMITS.uploadsPerOwner} Uploads. Delete one first.`,
    );
  await takeRate(caller.visitor, caller.owner, "upload");
  const tableName = uploadTableName(
    name,
    new Set(existing.map((row) => row.table_name)),
  );
  const id = randomUUID();
  const path = `uploads/${ownerFolder(caller.owner)}/${id}.${format}`;
  const signed = await storage()
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data)
    throw new StateError("The Upload could not be opened. Try again.");
  await db.begin(async (tx) => {
    await tx`
      insert into canvas.uploads (id, owner, name, table_name, format, bytes, storage_path, status)
      values (${id}, ${caller.owner}, ${name}, ${tableName}, ${format}, ${bytes}, ${path}, 'pending')`;
    await trailIn(tx, caller, {
      action: "upload.started",
      summary: `Upload opened: ${name}`,
      detail: { uploadId: id, name, bytes, format, table: tableName },
    });
  });
  return { uploadId: id, signedUrl: signed.data.signedUrl, tableName };
}

/**
 * The file is in Storage: copy it into the Owner's Sandbox, load it as a
 * Table and profile it. The size is checked again here, on the stored file,
 * because the number the browser gave earlier was only a claim.
 */
export async function profileUpload(caller: Caller, id: string): Promise<Upload> {
  const row = await owned(caller, id);
  if (row.status === "ready") return uploadOf(row);
  const fail = async (message: string) => {
    const [failed] = await sql()<Row[]>`
      update canvas.uploads set status = 'failed', error = ${message.slice(0, 400)}
      where id = ${row.id} and owner = ${caller.owner}
      returning *`;
    await storage().from(BUCKET).remove([row.storage_path]).catch(() => {});
    await trail(caller, {
      action: "upload.failed",
      summary: `Upload failed: ${row.name}: ${message}`.slice(0, 280),
      detail: { uploadId: row.id, error: message },
    });
    return uploadOf(failed ?? { ...row, status: "failed", error: message });
  };
  const file = await storage().from(BUCKET).download(row.storage_path);
  if (file.error || !file.data)
    return fail("The file did not arrive. Upload it again.");
  const content = Buffer.from(await file.data.arrayBuffer());
  if (content.byteLength > LIMITS.uploadBytes)
    return fail(
      `The file is ${Math.ceil(content.byteLength / 1024 / 1024)} MB; the most an Upload may be is ${LIMITS.uploadBytes / 1024 / 1024} MB.`,
    );
  const path = await putInbox(caller.owner, content, row.format);
  const { answer, ms } = await runJob(
    caller.owner,
    {
      op: "import",
      table: row.table_name,
      path,
      format: row.format,
      seconds: LIMITS.runSeconds,
      maxColumns: LIMITS.uploadColumns,
    },
    LIMITS.runSeconds,
  );
  if (answer.error)
    return fail(
      answer.kind === "timeout"
        ? "Reading the file took too long."
        : `DuckDB could not read the file: ${answer.error}`,
    );
  const profile: UploadProfile = {
    rows: Number(answer.rows ?? 0),
    columns: (answer.columns as UploadProfile["columns"]) ?? [],
    sample: (answer.sample as UploadProfile["sample"]) ?? [],
  };
  const [ready] = await sql().begin(async (tx) => {
    const saved = await tx<Row[]>`
      update canvas.uploads
      set status = 'ready', profile = ${jsonb(tx, profile)}, bytes = ${content.byteLength}, error = null
      where id = ${row.id} and owner = ${caller.owner}
      returning *`;
    await trailIn(tx, caller, {
      action: "upload.profiled",
      summary: `${row.name} is Table ${row.table_name}: ${profile.rows} rows, ${profile.columns.length} columns`,
      detail: {
        uploadId: row.id,
        table: row.table_name,
        rows: profile.rows,
        columns: profile.columns.map((column) => `${column.name} ${column.type}`),
      },
      ms,
    });
    return saved;
  });
  return uploadOf(ready);
}

/** Deletes an Upload: its Table in the Sandbox, its file in Storage and its row. */
export async function deleteUpload(caller: Caller, id: string) {
  const row = await owned(caller, id);
  await sql().begin(async (tx) => {
    await tx`delete from canvas.uploads where id = ${row.id} and owner = ${caller.owner}`;
    await trailIn(tx, caller, {
      action: "upload.deleted",
      summary: `Deleted Upload ${row.name}`,
      detail: { uploadId: row.id, table: row.table_name },
    });
  });
  await storage().from(BUCKET).remove([row.storage_path]).catch(() => {});
  if (row.status === "ready")
    await runJob(
      caller.owner,
      { op: "drop", table: row.table_name },
      LIMITS.runSeconds,
    ).catch(() => {});
}
