import { z } from "zod";
import { InvalidError } from "@/features/bank/core/errors";
import { commandDef } from "@/features/bank/domain/commands";
import { read } from "@/features/bank/server/bank";
import { actorOf, requireStaff } from "@/features/bank/server/context";
import { failure, json } from "@/features/bank/server/respond";

/**
 * Every read of the bank, one route per read command (`domain/commands.ts`):
 * GET /api/bank/read/<command>?input=<JSON>. Passes the gate, validates the
 * input with the command's schema and scopes the read to the Owner, in the
 * engine. Writes are server actions, never this route.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/bank/read/[name]">,
) {
  try {
    const context = await requireStaff();
    const { name } = await params;
    if (commandDef(name)?.kind !== "read") throw new InvalidError("There is no such read.");
    const raw = new URL(request.url).searchParams.get("input");
    let input: unknown = {};
    if (raw) {
      try {
        input = z.record(z.string(), z.unknown()).parse(JSON.parse(raw));
      } catch {
        throw new InvalidError("The input is not valid JSON.");
      }
    }
    return json(await read(actorOf(context), name, input));
  } catch (error) {
    return failure(error);
  }
}
