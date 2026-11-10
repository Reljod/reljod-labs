import "server-only";
import { getRun, start } from "workflow/api";
import { z } from "zod";
import type {
  BuildEvent,
  BuildStats,
  Persona,
  SourceKind,
  SourceView,
} from "../domain/events";
import { safeExtension } from "../domain/file-name";
import type { DraftGraph } from "../domain/graph";
import { slugify } from "../domain/graph";
import { buildWorkflow } from "./build-workflow";
import { env } from "./env";
import { kindOf, mediaTypeFor } from "./gather";
import {
  addMessage,
  type BuildRow,
  type CatalogRow,
  type ClientRow,
  canView,
  claimBuild,
  clientSpend,
  createBuild,
  createClientRow,
  createSources,
  deleteClient,
  getBuild,
  getClient,
  latestBuild,
  listCatalog,
  listMessages,
  loadGraph,
  type MessageRow,
  repairsOfClient,
  setClientStatus,
  setPortrait,
  sourcesOfClient,
  updateBuild,
  usageSince,
} from "./repository";
import type { Visitor } from "./session";
import { removeFolder, signedUrl, signedUrls, uploadUrl } from "./storage";

export const LIMITS = {
  files: 8,
  fileBytes: 10 * 1024 * 1024,
  noteChars: 20_000,
  buildsPerHour: 6,
  asksPerHour: 40,
  buildsPerDay: 150,
  spendPerVisitorPerDay: 2,
};

export class LimitError extends Error {}

export const fileSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.string().max(120),
  size: z.number().int().min(1).max(LIMITS.fileBytes),
});

export const intakeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  note: z.string().max(LIMITS.noteChars).default(""),
  files: z.array(fileSchema).max(LIMITS.files).default([]),
  portrait: fileSchema.nullable().default(null),
  sample: z.boolean().default(false),
});

export const additionSchema = z.object({
  note: z.string().max(LIMITS.noteChars).default(""),
  files: z.array(fileSchema).max(LIMITS.files).default([]),
});

export async function checkLimits(visitor: Visitor, kind: "build" | "ask") {
  if (visitor.trusted) return;
  const hour = await usageSince(visitor.hash, new Date(Date.now() - 3_600_000));
  const day = await usageSince(visitor.hash, new Date(Date.now() - 86_400_000));
  if (day.cost >= LIMITS.spendPerVisitorPerDay) {
    throw new LimitError(
      "You've used today's model budget for this demo. Come back tomorrow.",
    );
  }
  if (kind === "build") {
    if (hour.builds >= LIMITS.buildsPerHour) {
      throw new LimitError(
        `That's ${LIMITS.buildsPerHour} graph builds this hour. Try again soon.`,
      );
    }
    const everyone = await usageSince(null, new Date(Date.now() - 86_400_000));
    if (everyone.builds >= LIMITS.buildsPerDay) {
      throw new LimitError(
        "The demo has reached today's limit of graph builds.",
      );
    }
  } else if (hour.messages >= LIMITS.asksPerHour) {
    throw new LimitError(
      `That's ${LIMITS.asksPerHour} questions this hour. Try again soon.`,
    );
  }
}

type Upload = { sourceId: string; name: string; url: string };

function fileSources(
  clientId: string,
  buildId: string,
  files: z.infer<typeof fileSchema>[],
) {
  return files.map((file, index) => {
    const kind = kindOf(file.name, file.type);
    if (!kind)
      throw new LimitError(
        `${file.name}: use PDF, images, xlsx, csv, docx, txt or md.`,
      );
    const extension = safeExtension(file.name, "bin");
    const stem = slugify(file.name.replace(/\.[^.]+$/, "")) || "file";
    return {
      clientId,
      buildId,
      kind,
      name: file.name,
      mediaType: mediaTypeFor(kind, file.name, file.type),
      storagePath: `clients/${clientId}/sources/${buildId}/${index}-${stem}.${extension}`,
      byteSize: file.size,
      text: null,
    };
  });
}

async function prepareBuild(input: {
  clientId: string;
  trigger: "intake" | "addition";
  note: string;
  files: z.infer<typeof fileSchema>[];
  visitor: Visitor;
}): Promise<{ buildId: string; uploads: Upload[] }> {
  const note = input.note.trim();
  if (!note && input.files.length === 0) {
    throw new LimitError("Add a note or at least one file.");
  }
  const buildId = await createBuild({
    clientId: input.clientId,
    trigger: input.trigger,
    visitorHash: input.visitor.hash,
  });
  const rows = [
    ...(note
      ? [
          {
            clientId: input.clientId,
            buildId,
            kind: "note" as SourceKind,
            name: input.trigger === "intake" ? "Intake note" : "Added note",
            mediaType: "text/plain",
            storagePath: null,
            byteSize: note.length,
            text: note,
          },
        ]
      : []),
    ...fileSources(input.clientId, buildId, input.files),
  ];
  const sources = await createSources(rows);
  const uploads: Upload[] = [];
  for (const source of sources) {
    if (!source.storage_path) continue;
    uploads.push({
      sourceId: source.id,
      name: source.name,
      url: await uploadUrl(source.storage_path),
    });
  }
  return { buildId, uploads };
}

export async function createIntake(
  raw: unknown,
  visitor: Visitor,
  sessionId: string,
) {
  const input = intakeSchema.parse(raw);
  await checkLimits(visitor, "build");
  const isSample = input.sample && visitor.trusted;
  const clientId = await createClientRow({
    name: input.name,
    sessionId: isSample ? null : sessionId,
    isSample,
    visitorHash: visitor.hash,
  });
  const { buildId, uploads } = await prepareBuild({
    clientId,
    trigger: "intake",
    note: input.note,
    files: input.files,
    visitor,
  });
  let portraitUpload: { url: string } | null = null;
  if (input.portrait) {
    const extension = safeExtension(input.portrait.name, "jpg");
    const path = `clients/${clientId}/portrait-uploaded.${extension}`;
    portraitUpload = { url: await uploadUrl(path) };
    await setPortrait(clientId, path, "uploaded");
  }
  const summary = [
    input.note.trim()
      ? `a ${input.note.trim().length.toLocaleString("en-US")}-character note`
      : null,
    input.files.length > 0
      ? `${input.files.length} file${input.files.length === 1 ? "" : "s"} (${input.files.map((file) => file.name).join(", ")})`
      : null,
  ]
    .filter(Boolean)
    .join(" and ");
  await addMessage({
    clientId,
    sessionId,
    role: "user",
    mode: "build",
    content: `New client: ${input.name}. Built from ${summary}.`,
    buildId,
    visitorHash: visitor.hash,
  });
  return { clientId, buildId, uploads, portraitUpload };
}

export async function createAddition(
  client: ClientRow,
  raw: unknown,
  visitor: Visitor,
  sessionId: string,
  /** False when the chat already shows the person's words. */
  announce = true,
) {
  const input = additionSchema.parse(raw);
  if (client.is_sample && !visitor.trusted) {
    throw new LimitError(
      "Sample clients are read-only. Add your own client to try additions.",
    );
  }
  const running = await latestBuild(client.id);
  if (running && isAbandoned(running)) {
    // Its browser never started it (an upload failed, the tab closed).
    await updateBuild(running.id, { status: "failed", error: "Never started" });
  } else if (running && ["queued", "running"].includes(running.status)) {
    throw new LimitError("A build is already running for this client.");
  }
  await checkLimits(visitor, "build");
  const { buildId, uploads } = await prepareBuild({
    clientId: client.id,
    trigger: "addition",
    note: input.note,
    files: input.files,
    visitor,
  });
  if (!announce) return { buildId, uploads };
  const parts = [
    input.note.trim(),
    input.files.length > 0
      ? `📎 ${input.files.map((file) => file.name).join(", ")}`
      : "",
  ].filter(Boolean);
  await addMessage({
    clientId: client.id,
    sessionId,
    role: "user",
    mode: "build",
    content: parts.join("\n"),
    buildId,
    visitorHash: visitor.hash,
  });
  return { buildId, uploads };
}

/** Starts the Build's workflow once the browser has uploaded its files. */
export async function startBuild(build: BuildRow, visitor: Visitor) {
  if (!(await claimBuild(build.id))) return;
  try {
    const run = await start(buildWorkflow, [
      {
        buildId: build.id,
        clientId: build.client_id,
        visitorHash: visitor.hash,
        trigger: build.trigger,
      },
    ]);
    await updateBuild(build.id, { workflowRunId: run.runId });
  } catch (error) {
    await updateBuild(build.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** How long a Build may wait for its browser to call `/start`. */
const START_GRACE_MS = 5 * 60 * 1000;

function isAbandoned(build: BuildRow) {
  return (
    build.status === "queued" &&
    !build.workflow_run_id &&
    Date.now() - build.created_at.getTime() > START_GRACE_MS
  );
}

/**
 * Deletes a Client: stops a Build still going, removes their files and
 * portraits from Storage, then the rows (everything else cascades).
 */
export async function removeClient(client: ClientRow) {
  const build = await latestBuild(client.id);
  if (build && ["queued", "running"].includes(build.status)) {
    await stopBuild(build).catch(() => {});
  }
  await removeFolder(`clients/${client.id}`).catch(() => {
    // Storage clean-up never blocks the delete; the bucket is private.
  });
  await deleteClient(client.id);
}

/**
 * Stops a Build: cancels its workflow and tells whoever is watching. A model
 * call already in flight still finishes and is billed; nothing after it runs.
 */
export async function stopBuild(build: BuildRow) {
  if (!["queued", "running"].includes(build.status)) return;
  if (build.workflow_run_id) {
    const run = getRun(build.workflow_run_id);
    try {
      await run.cancel({ cancelReason: "Stopped by the person" });
    } catch {
      // Already over; the row still has to close.
    }
    try {
      const writer = run.getWritable<BuildEvent>().getWriter();
      const at = Date.now();
      await writer.write({
        at,
        type: "log",
        level: "warn",
        text: "stopped by the person",
      });
      await writer.write({
        at,
        type: "end",
        status: "stopped",
        error: "Stopped",
      });
      writer.releaseLock();
    } catch {
      // The stream is closed; watchers see the stopped row on reload.
    }
  }
  await updateBuild(build.id, {
    status: "stopped",
    error: "Stopped by the person",
  });
  if (build.trigger === "intake")
    await setClientStatus(build.client_id, "failed");
}

/** The Build, if this session may watch it. */
export async function viewableBuild(buildId: string, sessionId: string | null) {
  const build = await getBuild(buildId);
  if (!build) return null;
  const client = await getClient(build.client_id);
  if (!client || !canView(client, sessionId)) return null;
  return { build, client };
}

export async function viewableClient(
  clientId: string,
  sessionId: string | null,
) {
  const client = await getClient(clientId);
  return client && canView(client, sessionId) ? client : null;
}

export async function ownedClient(
  clientId: string,
  sessionId: string | null,
  visitor: Visitor,
) {
  const client = await getClient(clientId);
  if (!client) return null;
  if (client.session_id && client.session_id === sessionId) return client;
  if (client.is_sample && visitor.trusted) return client;
  return null;
}

// Views ---------------------------------------------------------------------------

export type CatalogCard = {
  id: string;
  name: string;
  isSample: boolean;
  status: ClientRow["status"];
  building: boolean;
  persona: Persona | null;
  portraitUrl: string | null;
  nodes: number;
  edges: number;
  branches: Record<string, number>;
  createdAt: string;
};

export async function catalog(
  sessionId: string | null,
): Promise<CatalogCard[]> {
  const rows = await listCatalog(sessionId);
  const urls = await signedUrls(
    rows.flatMap((row) => (row.portrait_path ? [row.portrait_path] : [])),
  );
  return rows.map((row: CatalogRow) => ({
    id: row.id,
    name: row.name,
    isSample: row.is_sample,
    status: row.status,
    building:
      row.last_build_status === "queued" || row.last_build_status === "running",
    persona: row.persona,
    portraitUrl: row.portrait_path
      ? (urls.get(row.portrait_path) ?? null)
      : null,
    nodes: row.node_count,
    edges: row.edge_count,
    branches: row.branch_counts ?? {},
    createdAt: row.created_at.toISOString(),
  }));
}

export type MessageView = {
  id: string;
  role: MessageRow["role"];
  mode: MessageRow["mode"];
  content: string;
  traversal: MessageRow["traversal"];
  buildId: string | null;
  createdAt: string;
};

export type ClientView = {
  id: string;
  name: string;
  isSample: boolean;
  status: ClientRow["status"];
  persona: Persona | null;
  portraitUrl: string | null;
  portraitSource: ClientRow["portrait_source"];
  graph: DraftGraph;
  sources: (SourceView & { createdAt: string; buildId: string | null })[];
  messages: MessageView[];
  repairs: {
    round: number;
    by: string;
    op: string;
    detail: Record<string, string>;
    buildId: string;
  }[];
  latestBuild: {
    id: string;
    status: BuildRow["status"];
    trigger: BuildRow["trigger"];
    stats: BuildStats | null;
    error: string | null;
  } | null;
  spend: { costUsd: number; tokens: number };
  canAdd: boolean;
  /** The Navigator's model, as the chat header shows it. */
  chatModel: string;
};

export async function clientView(
  client: ClientRow,
  sessionId: string | null,
  visitor: Visitor | null,
): Promise<ClientView> {
  const [graph, sources, messages, build, spend, portraitUrl, repairs] =
    await Promise.all([
      loadGraph(client.id),
      sourcesOfClient(client.id),
      listMessages(client.id, sessionId),
      latestBuild(client.id),
      clientSpend(client.id),
      client.portrait_path
        ? signedUrl(client.portrait_path)
        : Promise.resolve(null),
      repairsOfClient(client.id),
    ]);
  return {
    id: client.id,
    name: client.name,
    isSample: client.is_sample,
    status: client.status,
    persona: client.persona,
    portraitUrl,
    portraitSource: client.portrait_source,
    graph,
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.kind,
      mediaType: source.media_type,
      chars: source.chars,
      buildId: source.build_id,
      createdAt: source.created_at.toISOString(),
    })),
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      mode: message.mode,
      content: message.content,
      traversal: message.traversal,
      buildId: message.build_id,
      createdAt: message.created_at.toISOString(),
    })),
    repairs: repairs.map((repair) => ({
      round: repair.round,
      by: repair.by,
      op: repair.op,
      detail: repair.detail,
      buildId: repair.build_id,
    })),
    latestBuild: build
      ? {
          id: build.id,
          status: build.status,
          trigger: build.trigger,
          stats: build.stats,
          error: build.error,
        }
      : null,
    spend: { costUsd: spend.cost, tokens: spend.tokens },
    canAdd:
      (!!sessionId && client.session_id === sessionId) ||
      (client.is_sample && !!visitor?.trusted),
    chatModel: env.chatModel(),
  };
}
