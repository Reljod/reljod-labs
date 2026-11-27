import { switchboardApi } from "@/features/switchboard/server/api";

/**
 * Puts the Back office back to its seed. Calls, Rules and the trail stay;
 * the Records it replaces move to the archive, not away.
 */
export const POST = switchboardApi.handle(({ services, owner }) =>
  services.office.reset(owner),
);
