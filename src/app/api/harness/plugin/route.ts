import { getPublicOrigin } from "mcp-handler";
import { harnessApi, permits } from "@/features/harness/server/api";
import { authorize } from "@/platform/http/middleware";
import { CACHE } from "@/platform/http/respond";

/** The Claude Plugin: a zip of the Workspace's current Skills and the MCP server's address. */
export const GET = harnessApi
  .use(authorize(permits("plugin.download")))
  .handle(async ({ services, caller, request }) => {
    // The public address, as the MCP token and the OAuth metadata give it.
    const plugin = await services.skills.plugin(
      caller,
      getPublicOrigin(request),
    );
    return new Response(plugin.bytes, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${plugin.filename}"`,
        "cache-control": CACHE.none,
      },
    });
  });
