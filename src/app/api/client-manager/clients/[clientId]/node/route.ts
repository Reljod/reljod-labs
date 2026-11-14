import {
  clientNode,
  viewableClient,
} from "@/features/client-manager/server/service";
import { currentSessionId } from "@/features/client-manager/server/session";
import { failure, notFound } from "../../../respond";

/** One fact in full: its quotes, and every relation with its own quotes. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]/node">,
) {
  try {
    const { clientId } = await params;
    const client = await viewableClient(clientId, await currentSessionId());
    if (!client) return notFound();
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!key || key.length > 160) return notFound();
    const node = await clientNode(client.id, key);
    return node ? Response.json(node) : notFound();
  } catch (error) {
    return failure(error);
  }
}
