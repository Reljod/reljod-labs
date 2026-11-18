import { z } from "zod";
import type { NodeResponse } from "@/features/client-manager/domain/api";
import {
  failure,
  json,
  NO_STORE,
  notFound,
  SEED,
} from "@/features/client-manager/server/respond";
import {
  clientNode,
  gatedClient,
} from "@/features/client-manager/server/service";

const querySchema = z.object({
  key: z.string().min(1, "Which fact?").max(160, "That key is too long."),
});

/** One fact in full: its quotes, and every relation with its own quotes. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]/node">,
) {
  try {
    const { clientId } = await params;
    const { key } = querySchema.parse({
      key: new URL(request.url).searchParams.get("key") ?? "",
    });
    const { client } = await gatedClient(clientId);
    if (!client) return notFound();
    const node = await clientNode(client.id, key);
    return node
      ? json<NodeResponse>(node, {
          cache: client.is_sample ? SEED : NO_STORE,
        })
      : notFound();
  } catch (error) {
    return failure(error);
  }
}
