import { requireAccess } from "@/features/access/server/gate";
import type { CorpusResponse } from "@/features/loupe/domain/api";
import { corpusResponse } from "@/features/loupe/server/reads";
import { failure, json, SEED } from "@/features/loupe/server/respond";

/** The Manifest and every recorded Sweep: seed data, so the page can calibrate a Rulebook being edited. */
export async function GET() {
  try {
    await requireAccess();
    return json<CorpusResponse>(corpusResponse(), { cache: SEED });
  } catch (error) {
    return failure(error);
  }
}
