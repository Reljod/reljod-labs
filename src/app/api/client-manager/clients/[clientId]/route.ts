import {
  clientSummary,
  ownedClient,
  removeClient,
  viewableClient,
} from "@/features/client-manager/server/service";
import {
  currentOwner,
  visitor,
} from "@/features/client-manager/server/session";
import { failure, notFound } from "../../respond";

/** A client's first frame: profile and facts, without Edges or quotes. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]">,
) {
  try {
    const { clientId } = await params;
    const owner = await currentOwner();
    const client = await viewableClient(clientId, owner);
    if (!client) return notFound();
    return Response.json(await clientSummary(client, owner, await visitor()));
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
    return Response.json({ deleted: true });
  } catch (error) {
    return failure(error);
  }
}
