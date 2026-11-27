import { after } from "next/server";
import type { CatalogResponse } from "@/features/client-manager/domain/api";
import { failure, json } from "@/features/client-manager/server/respond";
import {
  catalog,
  createIntake,
  purgeDeletedClients,
} from "@/features/client-manager/server/service";
import {
  currentOwner,
  visitor,
} from "@/features/client-manager/server/session";

/** The Catalog: every Sample plus this browser's own clients. */
export async function GET() {
  try {
    // Clients deleted 30 days ago leave Storage after a read, not on a cron:
    // Storage cannot be emptied from SQL.
    after(() => purgeDeletedClients());
    return json<CatalogResponse>({
      clients: await catalog(await currentOwner()),
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * The Intake: creates the client and its first Build, and hands back signed
 * URLs the browser uploads each file to before starting the Build.
 */
export async function POST(request: Request) {
  try {
    const owner = await currentOwner();
    return json(
      await createIntake(await request.json(), await visitor(), owner),
    );
  } catch (error) {
    return failure(error);
  }
}
