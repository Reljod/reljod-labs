import type { StaffListResponse } from "@/features/harness/domain/api";
import { harnessApi } from "@/features/harness/server/api";

/** The Workspace's Staff and who the visitor is signed in as (the gate reads both: no second read). */
export const GET = harnessApi.handle(
  ({ staff, everyone }): StaffListResponse => ({
    staff: everyone,
    current: staff,
  }),
);
