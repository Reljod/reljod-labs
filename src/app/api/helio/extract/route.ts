import { accessOrDenied } from "@/features/access/server/gate";
import {
  decodeImageDataUrl,
  extractRequestSchema,
} from "@/features/helio/domain/schemas";
import { takeRate, visitor } from "@/features/helio/server/rate";
import { failure, isStubRequest, json } from "@/features/helio/server/respond";
import { generateRgbaPlate } from "@/features/helio/server/studio";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const access = await accessOrDenied();
    if (access instanceof Response) return access;

    const raw = await request.json().catch(() => null);
    const parsed = extractRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return json(
        { error: parsed.error.issues[0]?.message || "Invalid request body." },
        400,
      );
    }

    const stub = isStubRequest(request);
    let sourceImage: Uint8Array | undefined;

    if (parsed.data.mode === "isolate") {
      const decoded = decodeImageDataUrl(parsed.data.imageDataUrl);
      if (!decoded.ok) {
        return json({ error: decoded.error }, 400);
      }
      sourceImage = decoded.image.bytes;
    }

    // Take Postgres advisory-locked rate BEFORE the paid model call.
    if (!stub) {
      const who = await visitor();
      await takeRate(who, "image", 1);
    }

    const result = await generateRgbaPlate({
      mode: parsed.data.mode,
      sourceImage,
      concept:
        parsed.data.mode === "synthesize" ? parsed.data.concept : undefined,
      productName: parsed.data.productName,
      stub,
    });

    return json({
      imageDataUrl: result.imageDataUrl,
      model: result.model,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
    });
  } catch (error) {
    return failure(error);
  }
}
