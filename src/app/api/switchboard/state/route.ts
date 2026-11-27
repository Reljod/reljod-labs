import type { FirstView } from "@/features/switchboard/domain/api";
import { switchboardApi } from "@/features/switchboard/server/api";

/** The Back office, the Rules, the saved Calls and this hour's caps (`FirstView`). */
export const GET = switchboardApi.handle(
  ({ services, caller }): Promise<FirstView> =>
    services.office.firstView(caller),
);
