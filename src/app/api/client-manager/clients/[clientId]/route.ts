import {
  clientView,
  ownedClient,
  removeClient,
  viewableClient,
} from "@/features/client-manager/server/service";
import {
  currentSessionId,
  visitor,
} from "@/features/client-manager/server/session";
import { failure, notFound } from "../../respond";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]">,
) {
  try {
    const { clientId } = await params;
    const sessionId = await currentSessionId();
    const client = await viewableClient(clientId, sessionId);
    if (!client) return notFound();
    return Response.json(await clientView(client, sessionId, await visitor()));
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
      await currentSessionId(),
      await visitor(),
    );
    if (!client) return notFound();
    await removeClient(client);
    return Response.json({ deleted: true });
  } catch (error) {
    return failure(error);
  }
}
