import { accessOrDenied } from "@/features/access/server/gate";
import {
  auditRequestSchema,
  decodeImageDataUrl,
} from "@/features/helio/domain/schemas";
import { takeRate } from "@/features/helio/server/rate";
import {
  failure,
  isStubRequest,
  json,
  visitorKeyOf,
} from "@/features/helio/server/respond";
import {
  auditStagedFrame,
  resolveProductSource,
} from "@/features/helio/server/studio";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const access = await accessOrDenied();
    if (access instanceof Response) return access;

    const raw = await request.json().catch(() => null);
    const parsed = auditRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return json(
        { error: parsed.error.issues[0]?.message || "Invalid audit request." },
        400,
      );
    }

    const data = parsed.data;
    const stagedDecoded = decodeImageDataUrl(data.stagedImageDataUrl);
    if (!stagedDecoded.ok) return json({ error: stagedDecoded.error }, 400);

    const product = await resolveProductSource(data.product);
    const stub = isStubRequest(request);

    if (!stub) {
      takeRate({
        visitorKey: visitorKeyOf(access),
        bucket: "director",
        units: 1,
      });
    }

    const audit = await auditStagedFrame({
      product,
      stagedBytes: stagedDecoded.image.bytes,
      stagedMediaType: stagedDecoded.image.mediaType,
      marketId: data.marketId,
      directionSummary: data.directionSummary,
      stub,
    });

    return json(audit);
  } catch (error) {
    return failure(error);
  }
}
