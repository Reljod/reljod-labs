import { PluginError } from "@/features/harness/domain/plugin";
import { audit } from "@/features/harness/server/audit";
import { staffOrDenied } from "@/features/harness/server/context";
import { InvalidError } from "@/features/harness/server/errors";
import { originOf } from "@/features/harness/server/oauth-http";
import { failure } from "@/features/harness/server/respond";
import { buildPluginZip } from "@/features/harness/server/skills";

/** The Claude Plugin: a zip of the Workspace's current Skills and the MCP server's address. */
export async function GET(request: Request) {
  try {
    const context = await staffOrDenied("plugin.download");
    if (context instanceof Response) return context;
    // The public address, as the MCP token and the OAuth metadata give it.
    const origin = originOf(request);
    let built: Awaited<ReturnType<typeof buildPluginZip>>;
    try {
      built = await buildPluginZip(context.owner, origin);
    } catch (error) {
      if (error instanceof PluginError) throw new InvalidError(error.message);
      throw error;
    }
    await audit({
      owner: context.owner,
      actor: { kind: "staff", staff: context.staff },
      action: "plugin.downloaded",
      summary: `Downloaded the Claude plugin (${built.files.length} files)`,
      target: { kind: "plugin", id: "jod-harness-bank" },
      detail: { files: built.files.length, bytes: built.bytes.byteLength },
    });
    return new Response(built.bytes, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${built.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
