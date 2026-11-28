import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { Visitor } from "@/platform/request/visitor";
import type {
  Allowance,
  AskAnswer,
  Source,
  UploadTicket,
  WalkEvent,
} from "../domain/api";
import { LIMITS } from "../domain/limits";
import { assertOwnSource, loadFootage, uploadFolder } from "./footage";
import type { FloorwalkPorts } from "./ports";

/** Who a Floorwalk call is for: the Owner whose uploads it may read, the visitor whose caps it spends. */
export type Caller = { owner: Owner; visitor: Visitor };

/** Where a Sample's file may be fetched from when it is not on disk, and how to stop. */
export type Watch = { origin: string; signal?: AbortSignal };

/**
 * Everything Floorwalk does. The REST routes are thin adapters over it; so
 * would an MCP tool be. Every method checks the caller's own upload and
 * takes the rate before it reads footage, and both before the model.
 */
export interface FloorwalkService {
  allowance(visitor: Visitor): Promise<Allowance>;
  prepareUpload(
    caller: Caller,
    file: { type: "video/mp4" | "video/quicktime"; size: number },
  ): Promise<UploadTicket>;
  /** Resolves once the gate, the upload's owner and the rate are passed; then the events stream. */
  walk(
    caller: Caller,
    source: Source,
    watch: Watch,
  ): Promise<AsyncGenerator<WalkEvent>>;
  ask(
    caller: Caller,
    source: Source,
    question: string,
    watch: Watch,
  ): Promise<AskAnswer>;
}

export function createFloorwalkService(
  ports: FloorwalkPorts,
): FloorwalkService {
  const { store, walker, rate } = ports;
  const sweepLater = () => ports.later(() => store.sweep());

  async function footageFor(caller: Caller, source: Source, origin: string) {
    sweepLater();
    return loadFootage(source, caller.owner, origin, store.download);
  }

  return {
    async allowance(visitor) {
      const used = await rate.used(visitor, ["walk", "ask"]);
      sweepLater();
      return {
        walksUsed: used.walk,
        walksPerHour: LIMITS.walksPerHour,
        asksUsed: used.ask,
        asksPerHour: LIMITS.asksPerHour,
        model: walker.model,
      };
    },

    async prepareUpload(caller, file) {
      await rate.take("upload", caller.visitor);
      sweepLater();
      const extension = file.type === "video/quicktime" ? "mov" : "mp4";
      const path = `${uploadFolder(caller.owner)}/${ports.newId()}.${extension}`;
      return { path, signedUrl: await store.uploadUrl(path) };
    },

    async walk(caller, source, watch) {
      assertOwnSource(source, caller.owner);
      await rate.take("walk", caller.visitor);
      const footage = await footageFor(caller, source, watch.origin);
      return walker.walk(footage, watch.signal);
    },

    async ask(caller, source, question, watch) {
      assertOwnSource(source, caller.owner);
      await rate.take("ask", caller.visitor);
      const footage = await footageFor(caller, source, watch.origin);
      return walker.ask(footage, question, watch.signal);
    },
  };
}
