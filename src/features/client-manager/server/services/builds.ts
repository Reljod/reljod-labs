import {
  ConflictError,
  ForbiddenError,
  InvalidError,
  NotFoundError,
} from "@/platform/errors";
import type { Visitor } from "@/platform/request/visitor";
import {
  type AdditionInput,
  type AdditionResponse,
  type FactsInput,
  type FileMeta,
  factsSchema,
  type IntakeInput,
  type IntakeResponse,
  type Upload,
} from "../../domain/api";
import type { BuildEvent, SourceKind } from "../../domain/events";
import { kindOf, mediaTypeFor, safeExtension } from "../../domain/file-name";
import { slugify } from "../../domain/graph";
import type {
  BuildStore,
  BuildWorkflows,
  Caller,
  Caps,
  ClientStore,
  Files,
} from "../ports";
import type { BuildRow, ClientRow } from "../repository";
import { canChange, canView } from "./scope";

export type BuildPorts = {
  clients: Pick<ClientStore, "get" | "create" | "setStatus" | "setPortrait">;
  builds: BuildStore;
  caps: Caps;
  files: Pick<Files, "uploadUrl">;
  workflows: BuildWorkflows;
  now: () => number;
};

/**
 * Builds: an Intake (a new client and its first Build), an addition, facts
 * from the Desk or a Research card, and starting, stopping and watching a
 * Build. Every path that starts one takes the `build` cap (which writes the
 * Build row in the locked transaction) before any file is read or any model
 * is called, and only a client's Owner may start, stop or add to it.
 */
export interface BuildService {
  intake(caller: Caller, input: IntakeInput): Promise<IntakeResponse>;
  addition(
    caller: Caller,
    clientId: string,
    input: AdditionInput,
  ): Promise<AdditionResponse>;
  /** Facts as one Source and an addition Build that starts at once (no files to wait for). */
  addFacts(
    caller: Caller,
    clientId: string,
    input: FactsInput,
    origin: "research" | "chat",
  ): Promise<{ buildId: string; clientId: string; clientName: string }>;
  /** Starts the Build's workflow once the browser has uploaded its files. */
  start(caller: Caller, buildId: string): Promise<{ started: true }>;
  stop(caller: Caller, buildId: string): Promise<{ stopped: true }>;
  /** The Build's events from the `from`th on, for an Owner who may watch it. */
  events(
    owner: Caller["owner"],
    buildId: string,
    from: number,
  ): Promise<AsyncIterable<BuildEvent>>;
  /** Stops the client's Build that is still going, if any: before the client is deleted. */
  haltLatest(clientId: string): Promise<void>;
}

/** How long a Build may wait for its browser to call `/start`. */
export const START_GRACE_MS = 5 * 60 * 1000;

const ACTIVE = new Set<BuildRow["status"]>(["queued", "running"]);

export function createBuildService(ports: BuildPorts): BuildService {
  const { clients, builds, caps, files, workflows } = ports;

  /** Refuses unless the visitor said something: a note or a file. */
  function assertSomething(note: string, fileCount: number) {
    if (!note.trim() && fileCount === 0)
      throw new InvalidError("Add a note or at least one file.");
  }

  /** Every file's kind, checked before the cap is taken, so a refusal spends nothing. */
  function kindsOf(list: FileMeta[]): SourceKind[] {
    return list.map((file) => {
      const kind = kindOf(file.name, file.type);
      if (!kind)
        throw new InvalidError(
          `${file.name}: use PDF, images, xlsx, csv, docx, txt or md.`,
        );
      return kind;
    });
  }

  /** Throws unless a new addition may start on this client now. */
  async function assertIdle(clientId: string) {
    const running = await builds.latest(clientId);
    if (!running) return;
    if (
      running.status === "queued" &&
      !running.workflow_run_id &&
      ports.now() - running.created_at.getTime() > START_GRACE_MS
    ) {
      // Its browser never started it (an upload failed, the tab closed).
      await builds.update(running.id, {
        status: "failed",
        error: "Never started",
      });
      return;
    }
    if (ACTIVE.has(running.status))
      throw new ConflictError("A build is already running for this client.");
  }

  /** The Build's Sources and a signed upload URL for each file, all signed at once. */
  async function prepareSources(input: {
    clientId: string;
    buildId: string;
    trigger: BuildRow["trigger"];
    note: string;
    files: FileMeta[];
    kinds: SourceKind[];
  }): Promise<Upload[]> {
    const note = input.note.trim();
    const rows = [
      ...(note
        ? [
            {
              clientId: input.clientId,
              buildId: input.buildId,
              kind: "note" as SourceKind,
              name: input.trigger === "intake" ? "Intake note" : "Added note",
              mediaType: "text/plain",
              storagePath: null,
              byteSize: note.length,
              text: note,
            },
          ]
        : []),
      ...input.files.map((file, index) => {
        const kind = input.kinds[index] ?? "text";
        const extension = safeExtension(file.name, "bin");
        const stem = slugify(file.name.replace(/\.[^.]+$/, "")) || "file";
        return {
          clientId: input.clientId,
          buildId: input.buildId,
          kind,
          name: file.name,
          mediaType: mediaTypeFor(kind, file.name, file.type),
          storagePath: `clients/${input.clientId}/sources/${input.buildId}/${index}-${stem}.${extension}`,
          byteSize: file.size,
          text: null,
        };
      }),
    ];
    const sources = await builds.createSources(rows);
    return Promise.all(
      sources.flatMap((source) =>
        source.storage_path
          ? [
              files.uploadUrl(source.storage_path).then((url) => ({
                sourceId: source.id,
                name: source.name,
                url,
              })),
            ]
          : [],
      ),
    );
  }

  /** Claims the Build and starts its workflow; of two starts, one runs. */
  async function launch(
    build: Pick<BuildRow, "id" | "client_id" | "trigger">,
    visitor: Visitor,
  ) {
    if (!(await builds.claim(build.id))) return;
    try {
      const workflowRunId = await workflows.start({
        buildId: build.id,
        clientId: build.client_id,
        visitorHash: visitor.hash,
        trigger: build.trigger,
      });
      await builds.update(build.id, { workflowRunId });
    } catch (error) {
      await builds.update(build.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stops a Build: cancels its workflow and tells whoever is watching, both
   * best effort, then always closes the row (an escape hatch must work on
   * the workflow that already ended). A model call in flight still finishes
   * and is billed; nothing after it runs.
   */
  async function halt(build: BuildRow) {
    if (!ACTIVE.has(build.status)) return;
    if (build.workflow_run_id) {
      await workflows.cancel(build.workflow_run_id).catch(() => {});
      await workflows.announceStopped(build.workflow_run_id).catch(() => {});
    }
    await builds.update(build.id, {
      status: "stopped",
      error: "Stopped by the person",
    });
    if (build.trigger === "intake")
      await clients.setStatus(build.client_id, "failed");
  }

  /** The client, if this caller may change it; 404 when they may not even see it. */
  async function changeable(caller: Caller, clientId: string, why: string) {
    const client = await clients.get(clientId);
    if (!client || !canView(client, caller.owner))
      throw new NotFoundError("That client is gone.");
    if (!canChange(client, caller)) throw new ForbiddenError(why);
    return client;
  }

  /** The Build and its client, if this caller may start or stop it. */
  async function ownBuild(caller: Caller, buildId: string) {
    const build = await builds.withClient(buildId);
    if (
      !build ||
      !canChange(
        { owner: build.client_owner, is_sample: build.client_is_sample },
        caller,
      )
    )
      throw new NotFoundError("No such build.");
    return build;
  }

  return {
    async intake(caller, input) {
      assertSomething(input.note, input.files.length);
      const kinds = kindsOf(input.files);
      const { owner, visitor } = caller;
      const isSample = input.sample && visitor.trusted;
      const { clientId, buildId } = await caps.take(
        visitor,
        owner,
        "build",
        async (db) => {
          const clientId = await clients.create(
            {
              name: input.name,
              owner: isSample ? null : owner,
              isSample,
              visitorHash: visitor.hash,
            },
            db,
          );
          const buildId = await builds.create(
            { clientId, trigger: "intake", visitorHash: visitor.hash },
            db,
          );
          return { clientId, buildId };
        },
      );
      const portraitPath = input.portrait
        ? `clients/${clientId}/portrait-uploaded.${safeExtension(input.portrait.name, "jpg")}`
        : null;
      const [uploads, portraitUpload] = await Promise.all([
        prepareSources({
          clientId,
          buildId,
          trigger: "intake",
          note: input.note,
          files: input.files,
          kinds,
        }),
        portraitPath
          ? Promise.all([
              files.uploadUrl(portraitPath),
              clients.setPortrait(clientId, portraitPath, "uploaded"),
            ]).then(([url]) => ({ url }))
          : null,
      ]);
      const note = input.note.trim();
      const summary = [
        note ? `a ${note.length.toLocaleString("en-US")}-character note` : null,
        input.files.length > 0
          ? `${input.files.length} file${input.files.length === 1 ? "" : "s"} (${input.files.map((file) => file.name).join(", ")})`
          : null,
      ]
        .filter(Boolean)
        .join(" and ");
      await builds.addMessage({
        clientId,
        owner: isSample ? null : owner,
        role: "user",
        mode: "build",
        content: `New client: ${input.name}. Built from ${summary}.`,
        buildId,
        visitorHash: visitor.hash,
      });
      return { clientId, buildId, uploads, portraitUpload };
    },

    async addition(caller, clientId, input) {
      assertSomething(input.note, input.files.length);
      const kinds = kindsOf(input.files);
      const client = await changeable(
        caller,
        clientId,
        "Sample clients are read-only. Add your own client to try additions.",
      );
      await assertIdle(client.id);
      const buildId = await caps.take(
        caller.visitor,
        caller.owner,
        "build",
        (db) =>
          builds.create(
            {
              clientId: client.id,
              trigger: "addition",
              visitorHash: caller.visitor.hash,
            },
            db,
          ),
      );
      const uploads = await prepareSources({
        clientId: client.id,
        buildId,
        trigger: "addition",
        note: input.note,
        files: input.files,
        kinds,
      });
      const parts = [
        input.note.trim(),
        input.files.length > 0
          ? `📎 ${input.files.map((file) => file.name).join(", ")}`
          : "",
      ].filter(Boolean);
      await builds.addMessage({
        clientId: client.id,
        owner: client.owner ? caller.owner : null,
        role: "user",
        mode: "build",
        content: parts.join("\n"),
        buildId,
        visitorHash: caller.visitor.hash,
      });
      return { buildId, uploads };
    },

    async addFacts(caller, clientId, raw, origin) {
      const { facts } = factsSchema.parse(raw);
      const client: ClientRow = await changeable(
        caller,
        clientId,
        "That client is a read-only sample. Facts can be added to your own clients only.",
      );
      await assertIdle(client.id);
      const buildId = await caps.take(
        caller.visitor,
        client.owner,
        "build",
        (db) =>
          builds.create(
            {
              clientId: client.id,
              trigger: "addition",
              visitorHash: caller.visitor.hash,
            },
            db,
          ),
      );
      const linked = facts.some((fact) => fact.sourceUrl);
      const date = new Date(ports.now()).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const text = facts
        .map((fact) =>
          fact.sourceUrl
            ? `- ${fact.text} (Source: ${fact.sourceTitle ? `${fact.sourceTitle}, ` : ""}${fact.sourceUrl})`
            : `- ${fact.text}`,
        )
        .join("\n");
      await builds.createSources([
        {
          clientId: client.id,
          buildId,
          kind: linked ? "web" : "note",
          name:
            origin === "research"
              ? `Web research · ${date}`
              : `From chat · ${date}`,
          mediaType: "text/plain",
          storagePath: null,
          byteSize: text.length,
          text,
        },
      ]);
      await launch(
        { id: buildId, client_id: client.id, trigger: "addition" },
        caller.visitor,
      );
      return { buildId, clientId: client.id, clientName: client.name };
    },

    async start(caller, buildId) {
      const build = await ownBuild(caller, buildId);
      await launch(build, caller.visitor);
      return { started: true };
    },

    async stop(caller, buildId) {
      await halt(await ownBuild(caller, buildId));
      return { stopped: true };
    },

    async events(owner, buildId, from) {
      const build = await builds.withClient(buildId);
      if (
        !build ||
        !canView(
          { owner: build.client_owner, is_sample: build.client_is_sample },
          owner,
        )
      )
        throw new NotFoundError("No such build.");
      // Not started yet: the watcher asks again in a moment.
      if (!build.workflow_run_id)
        throw new NotFoundError("That build hasn't started.");
      return iterate(workflows.events(build.workflow_run_id, from));
    },

    async haltLatest(clientId) {
      const build = await builds.latest(clientId);
      if (build) await halt(build).catch(() => {});
    },
  };
}

/** A stream's chunks as an async iterable that releases the stream when the reader leaves. */
async function* iterate<T>(stream: ReadableStream<T>): AsyncGenerator<T> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
