import type { EdgeScope } from "@/features/client-manager/server/repository";
import {
  clientEdges,
  viewableClient,
} from "@/features/client-manager/server/service";
import { currentOwner } from "@/features/client-manager/server/session";
import { failure, notFound } from "../../../respond";

/** `root`, `branch:wealth`, `leaf:wealth.accounts` or `node:person:ivy-marsh`. */
function scopeOf(value: string | null): EdgeScope | null {
  if (!value || value === "root") return { kind: "root" };
  const [kind, ...rest] = value.split(":");
  const id = rest.join(":");
  if (!id || id.length > 120) return null;
  if (kind === "branch" && /^[a-z]+$/.test(id)) return { kind, id };
  if (kind === "leaf" && /^[a-z]+\.[a-z_]+$/.test(id)) return { kind, id };
  if (kind === "node") return { kind, key: id };
  return null;
}

/** The relations one part of the map needs; the map asks for more as you open things. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]/edges">,
) {
  try {
    const { clientId } = await params;
    const client = await viewableClient(clientId, await currentOwner());
    if (!client) return notFound();
    const scope = scopeOf(new URL(request.url).searchParams.get("scope"));
    if (!scope) return Response.json({ error: "Bad scope" }, { status: 400 });
    return Response.json({ edges: await clientEdges(client.id, scope) });
  } catch (error) {
    return failure(error);
  }
}
