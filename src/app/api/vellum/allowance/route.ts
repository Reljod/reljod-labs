import type { Allowance } from "@/features/vellum/domain/api";
import { vellumApi } from "@/features/vellum/server/api";

/** How many Passes the visitor has left this hour, and which model draws. */
export const GET = vellumApi.handle(
  ({ services, visitor }): Promise<Allowance> => services.allowance(visitor),
);
