import { z } from "zod";
import { paintPortrait } from "@/features/client-manager/server/persona";
import {
  getClient,
  setPortrait,
} from "@/features/client-manager/server/repository";
import {
  checkLimits,
  LimitError,
  ownedClient,
} from "@/features/client-manager/server/service";
import {
  currentSessionId,
  visitor,
} from "@/features/client-manager/server/session";
import {
  signedUrl,
  upload,
  uploadUrl,
} from "@/features/client-manager/server/storage";
import { failure, notFound } from "../../../respond";

export const maxDuration = 60;

const bodySchema = z.discriminatedUnion("mode", [
  // Step one of an upload: where to PUT the image.
  z.object({
    mode: z.literal("upload"),
    name: z.string().max(160),
    type: z.string().startsWith("image/"),
  }),
  // Step two: the image is there; make it the portrait.
  z.object({ mode: z.literal("confirm"), path: z.string().max(300) }),
  // Paint a new one from the Persona.
  z.object({ mode: z.literal("paint") }),
]);

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]/portrait">,
) {
  try {
    const { clientId } = await params;
    const who = await visitor();
    const client = await ownedClient(clientId, await currentSessionId(), who);
    if (!client) return notFound();
    const body = bodySchema.parse(await request.json());

    if (body.mode === "upload") {
      const extension =
        body.name
          .toLowerCase()
          .split(".")
          .pop()
          ?.replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `clients/${client.id}/portrait-uploaded-${Date.now()}.${extension}`;
      return Response.json({ path, url: await uploadUrl(path) });
    }
    if (body.mode === "confirm") {
      if (!body.path.startsWith(`clients/${client.id}/portrait-uploaded-`)) {
        return Response.json(
          { error: "That isn't this client's upload." },
          { status: 400 },
        );
      }
      await setPortrait(client.id, body.path, "uploaded");
      return Response.json({ url: await signedUrl(body.path) });
    }

    await checkLimits(who, "build");
    const fresh = await getClient(client.id);
    const prompt = fresh?.persona?.portraitPrompt;
    if (!prompt)
      throw new LimitError(
        "The portrait is painted once the graph has a Persona.",
      );
    const portrait = await paintPortrait({
      context: { clientId: client.id, buildId: null, visitorHash: who.hash },
      prompt,
    });
    const path = `clients/${client.id}/portrait-${Date.now()}.jpg`;
    await upload(path, portrait.image, portrait.mediaType);
    await setPortrait(client.id, path, "generated");
    return Response.json({ url: await signedUrl(path), usage: portrait.usage });
  } catch (error) {
    return failure(error);
  }
}
