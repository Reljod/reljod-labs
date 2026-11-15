import {
  clientSource,
  viewableClient,
} from "@/features/client-manager/server/service";
import { currentOwner } from "@/features/client-manager/server/session";
import { failure, notFound } from "../../../../respond";

/** A document as it was read, a link to the original, and every fact that quotes it. */
export async function GET(
  _request: Request,
  {
    params,
  }: RouteContext<"/api/client-manager/clients/[clientId]/sources/[sourceId]">,
) {
  try {
    const { clientId, sourceId } = await params;
    const client = await viewableClient(clientId, await currentOwner());
    if (!client) return notFound();
    const source = await clientSource(client.id, sourceId);
    return source ? Response.json(source) : notFound();
  } catch (error) {
    return failure(error);
  }
}
