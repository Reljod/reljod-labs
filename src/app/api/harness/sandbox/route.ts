import { z } from "zod";
import type { SandboxStatusResponse } from "@/features/harness/domain/api";
import { can } from "@/features/harness/domain/permissions";
import { staffOrDenied } from "@/features/harness/server/context";
import { ForbiddenError } from "@/features/harness/server/errors";
import { failure, json, notFound } from "@/features/harness/server/respond";
import { sandboxStatus } from "@/features/harness/server/sandbox";
import { readableSession } from "@/features/harness/server/sessions";

const querySchema = z.object({ session: z.string().uuid().optional() });

/** Whether the Sandbox can be used, by this Staff member, and this Session's container. */
export async function GET(request: Request) {
  try {
    const context = await staffOrDenied();
    if (context instanceof Response) return context;
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (query.session && !(await readableSession(context, query.session))) {
      return notFound("That Session is not in this Workspace.");
    }
    const status = await sandboxStatus({
      owner: context.owner,
      sessionId: query.session ?? null,
    });
    const canUse = can(context.staff, "sandbox.use");
    return json<SandboxStatusResponse>({
      sandbox: {
        ...status,
        canUse,
        cannotUseReason: canUse
          ? null
          : ForbiddenError.forAction("sandbox.use").message,
      },
    });
  } catch (error) {
    return failure(error);
  }
}
