import type { ClientResponse } from "@/features/client-manager/domain/api";
import {
  failure,
  json,
  notFound,
} from "@/features/client-manager/server/respond";
import {
  clientSummary,
  gatedClient,
  ownedClient,
  removeClient,
} from "@/features/client-manager/server/service";
import {
  currentOwner,
  visitor,
} from "@/features/client-manager/server/session";

/** A client's first frame: profile and facts, without Edges or quotes. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]">,
) {
  try {
    const { clientId } = await params;
    const { owner, client } = await gatedClient(clientId);
    if (!client) return notFound();
    // Never kept, even for a Sample: it carries a signed portrait URL that
    // dies in an hour, and `canAdd`, which depends on the visitor.
    return json<ClientResponse>(
      await clientSummary(client, owner, await visitor()),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]">,
) {
  try {
    const { clientId } = await params;
    const client = await ownedClient(
      clientId,
      await currentOwner(),
      await visitor(),
    );
    if (!client) return notFound();
    await removeClient(client);
    return json({ deleted: true });
  } catch (error) {
    return failure(error);
  }
}
