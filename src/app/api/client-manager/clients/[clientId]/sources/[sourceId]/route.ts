import type { SourceResponse } from "@/features/client-manager/domain/api";
import {
  failure,
  json,
  notFound,
} from "@/features/client-manager/server/respond";
import {
  clientSource,
  gatedClient,
} from "@/features/client-manager/server/service";

/** A document as it was read, a link to the original, and every fact that quotes it. */
export async function GET(
  _request: Request,
  {
    params,
  }: RouteContext<"/api/client-manager/clients/[clientId]/sources/[sourceId]">,
) {
  try {
    const { clientId, sourceId } = await params;
    const { client } = await gatedClient(clientId);
    if (!client) return notFound();
    const source = await clientSource(client.id, sourceId, client.is_sample);
    // Never kept, even for a Sample: `url` is a signed link that dies in an hour.
    return source ? json<SourceResponse>(source) : notFound();
  } catch (error) {
    return failure(error);
  }
}
