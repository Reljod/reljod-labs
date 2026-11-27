import { z } from "zod";
import type { StaffSwitchResponse } from "@/features/harness/domain/api";
import { harnessApi, staffCookie } from "@/features/harness/server/api";
import { body } from "@/platform/http/middleware";
import { json } from "@/platform/http/respond";

const schema = z.object({ staffId: z.string().uuid() });

/**
 * Signs the visitor in as another Staff member of their own Workspace and
 * remembers the choice in the `harness_staff` cookie. Anyone in a Workspace
 * may switch, by design (ADR 0014); the gate checks the cookie against the
 * Owner on every request.
 */
export const POST = harnessApi
  .use(body(schema))
  .handle(async ({ services, owner, staff, everyone, body }) => {
    const to = await services.staff.switchTo(
      owner,
      { staff, everyone },
      body.staffId,
    );
    return json<StaffSwitchResponse>(
      { staff: to },
      { headers: { "set-cookie": staffCookie(to.id) } },
    );
  });
