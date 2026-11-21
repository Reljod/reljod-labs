import { accessOrDenied } from "@/features/access/server/gate";
import { findMarket } from "@/features/helio/domain/samples";
import {
  decodeImageDataUrl,
  editRequestSchema,
} from "@/features/helio/domain/schemas";
import { takeRate } from "@/features/helio/server/rate";
import {
  failure,
  isStubRequest,
  json,
  visitorKeyOf,
} from "@/features/helio/server/respond";
import {
  editCampaignFrame,
  resolveProductSource,
} from "@/features/helio/server/studio";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const access = await accessOrDenied();
    if (access instanceof Response) return access;

    const raw = await request.json().catch(() => null);
    const parsed = editRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return json(
        { error: parsed.error.issues[0]?.message || "Invalid edit request." },
        400,
      );
    }

    const data = parsed.data;
    const market = findMarket(data.marketId);
    if (!market) return json({ error: "Unknown market." }, 400);

    const baseDecoded = decodeImageDataUrl(data.baseImageDataUrl);
    if (!baseDecoded.ok) return json({ error: baseDecoded.error }, 400);

    let extraReferenceBytes: Uint8Array | undefined;
    if (data.referenceImageDataUrl) {
      const refDecoded = decodeImageDataUrl(data.referenceImageDataUrl);
      if (!refDecoded.ok) return json({ error: refDecoded.error }, 400);
      extraReferenceBytes = refDecoded.image.bytes;
    }

    const product = await resolveProductSource(data.product);
    const stub = isStubRequest(request);

    if (!stub) {
      takeRate({
        visitorKey: visitorKeyOf(access),
        bucket: "image",
        units: 1,
      });
    }

    const edited = await editCampaignFrame({
      product,
      baseFrameBytes: baseDecoded.image.bytes,
      market,
      instruction: data.instruction,
      tier: data.tier,
      extraReferenceBytes,
      stub,
    });

    return json({
      imageDataUrl: edited.imageDataUrl,
      model: edited.model,
      latencyMs: edited.latencyMs,
      costUsd: edited.costUsd,
    });
  } catch (error) {
    return failure(error);
  }
}
