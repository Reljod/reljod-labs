import { ZodError } from "zod";
import { LimitError } from "@/features/client-manager/server/service";

/** Turns what a handler threw into a JSON answer the browser can show. */
export function failure(error: unknown) {
  if (error instanceof LimitError) {
    return Response.json({ error: error.message }, { status: 429 });
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "That request doesn't look right." },
      { status: 400 },
    );
  }
  console.error("client-manager", error);
  return Response.json(
    { error: "Something went wrong on our side." },
    { status: 500 },
  );
}

export const notFound = () =>
  Response.json({ error: "Not found" }, { status: 404 });
