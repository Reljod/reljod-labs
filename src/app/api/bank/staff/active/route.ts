import { activeStaffSchema } from "@/features/bank/domain/api";
import { bankApi, rememberStaff } from "@/features/bank/server/api";
import { body } from "@/platform/http/middleware";

/**
 * Signs the visitor in as another Staff member of their own bank: written
 * to the Audit trail, then remembered in the `bank_staff` cookie. Answers
 * the Staff member now active.
 */
export const PUT = bankApi
  .use(body(activeStaffSchema))
  .handle(async ({ services, context, body }) => {
    const staff = await services.staff.switchTo(context, body.staffId);
    await rememberStaff(staff.id);
    return staff;
  });
