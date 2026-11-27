import { loupeApi } from "@/features/loupe/server/api";
import { CACHE, json } from "@/platform/http/respond";

/** The Manifest and every recorded Sweep: seed data, so the page can calibrate a Rulebook being edited. */
export const GET = loupeApi.handle(({ services, request }) =>
  json(services.examinations.corpus(), { cache: CACHE.seed, request }),
);
