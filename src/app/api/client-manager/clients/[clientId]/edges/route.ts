import { z } from "zod";
import type { EdgesResponse } from "@/features/client-manager/domain/api";
import type { EdgeScope } from "@/features/client-manager/server/repository";
import {
  failure,
  json,
  NO_STORE,
  notFound,
  SEED,
} from "@/features/client-manager/server/respond";
import {
  clientEdges,
  gatedClient,
} from "@/features/client-manager/server/service";

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

const querySchema = z.object({
  scope: z
    .string()
    .max(160)
    .nullable()
    .transform((value, context) => {
      const scope = scopeOf(value);
      if (!scope) context.addIssue({ code: "custom", message: "Bad scope" });
      return scope as EdgeScope;
    }),
});

/** The relations one part of the map needs; the map asks for more as you open things. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]/edges">,
) {
  try {
    const { clientId } = await params;
    const { scope } = querySchema.parse({
      scope: new URL(request.url).searchParams.get("scope"),
    });
    const { client } = await gatedClient(clientId);
    if (!client) return notFound();
    return json<EdgesResponse>(
      { edges: await clientEdges(client.id, scope) },
      { cache: client.is_sample ? SEED : NO_STORE },
    );
  } catch (error) {
    return failure(error);
  }
}
