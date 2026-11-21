import { requireOwner } from "@/features/access/server/gate";
import { refractRequestSchema } from "@/features/prism/domain/api";
import { MERIDIAN_QUESTIONS } from "@/features/prism/domain/questions";
import { runDecision } from "@/features/prism/server/decide";
import { takeRate, visitor } from "@/features/prism/server/rate";
import { bodyOf, failure, json } from "@/features/prism/server/respond";

export async function POST(request: Request) {
  try {
    const [{ owner }, who, raw] = await Promise.all([
      requireOwner(),
      visitor(),
      bodyOf(request),
    ]);
    const input = refractRequestSchema.parse(raw);
    await takeRate(who, owner, "refract", 1);

    const result = await runDecision({
      modelId: input.modelId,
      state: input.state,
      questions: input.questions ?? MERIDIAN_QUESTIONS,
      stubbed: who.stubbed,
      abortSignal: request.signal,
    });
    return json(result);
  } catch (error) {
    return failure(error);
  }
}
