import { z } from "zod";
import type { StaffSwitchResponse } from "@/features/harness/domain/api";
import { switchStaff } from "@/features/harness/server/context";
import { bodyOf, failure, json } from "@/features/harness/server/respond";

const schema = z.object({ staffId: z.string().uuid() });

/** Signs the visitor in as another Staff member of their own Workspace. */
export async function POST(request: Request) {
  try {
    // `switchStaff` passes the gate and checks the Staff member against the Owner.
    const { staffId } = schema.parse(await bodyOf(request));
    return json<StaffSwitchResponse>({ staff: await switchStaff(staffId) });
  } catch (error) {
    return failure(error);
  }
}
