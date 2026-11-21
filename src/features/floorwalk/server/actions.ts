"use server";

import { randomUUID } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { ZodError } from "zod";
import { requireOwner } from "@/features/access/server/gate";
import { type UploadTicket, uploadRequestSchema } from "../domain/api";
import { LimitError } from "./errors";
import { uploadFolder } from "./footage";
import { take, visitor } from "./rate";
import { sweepUploads, uploadUrl } from "./storage";

export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * A one-time upload URL for the visitor's own footage, in their Owner's
 * folder. The video goes straight to the private bucket; the Walk reads it
 * from there and checks its type, size and length again before the model.
 */
export async function prepareUpload(input: {
  type: string;
  size: number;
}): Promise<ActionResult<UploadTicket>> {
  try {
    const [{ owner }, who] = await Promise.all([requireOwner(), visitor()]);
    const request = uploadRequestSchema.parse(input);
    await take("upload", who);
    const folder = uploadFolder(owner);
    after(sweepUploads);
    const path = `${folder}/${randomUUID()}.${request.type === "video/quicktime" ? "mov" : "mp4"}`;
    return { ok: true, value: { path, signedUrl: await uploadUrl(path) } };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof LimitError) return { ok: false, error: error.message };
    if (error instanceof ZodError)
      return {
        ok: false,
        error: error.issues[0]?.message ?? "That file can't be walked.",
      };
    console.error("[floorwalk] upload", error);
    return { ok: false, error: "The upload could not be prepared." };
  }
}
