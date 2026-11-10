import "server-only";
import { createMCPClient } from "@ai-sdk/mcp";
import { isStepCount, type ModelMessage, streamText, type ToolSet } from "ai";
import type { ChatEvent } from "../domain/chat-events";
import { kindLabel } from "../domain/document-kinds";
import { JOBS } from "../domain/jobs";
import { PIPELINE_IDS, PIPELINES } from "../domain/pipelines";
import { callOptions, trackCall } from "./llm";
import { mcpHandler } from "./mcp";
import {
  addMessage,
  documentsByIds,
  loadCaseFiles,
  loadMessages,
  openQuestions,
  runsForSession,
  type SessionRow,
} from "./repository";
import { settingsFor } from "./runs";
import { sessionToken } from "./session";

const INSTRUCTIONS = `You are the Specialist at the pension and onboarding desk of Corallis Trust & Pensions, a (fictional) Cayman Islands bank and trust company. You run review work through tools on the Casework MCP server: four pipelines and the single jobs they are built from.

Pipelines:
${PIPELINE_IDS.map((id) => `- pipeline_${id}: ${PIPELINES[id].title}. ${PIPELINES[id].blurb}.`).join("\n")}

Jobs (each runs alone, with whatever it depends on first):
${Object.entries(JOBS)
  .map(([id, job]) => `- job_${id}: ${job.title}`)
  .join("\n")}

How to work:
- When the person attaches documents and wants a review, start it straight away. Pick the pipeline when the request or the file names make it clear; when they do not, call review_documents and let it sort and decide.
- When they ask for one step ("just extract", "screen these names", "reconcile this schedule"), run that job, not a pipeline.
- To refer to documents in the Cabinet by folder or person, call find_documents first to get their ids.
- If a run is waiting on a question and the person's message answers it (documents, a choice, "skip", "go on without it"), call answer_question with the open question's id.
- Never invent document ids, run ids or findings. Results stream onto the desk by themselves; do not narrate them or guess outcomes.
- After a tool call, reply in one or two short sentences: what you started and what to watch for. No lists, no headings, no em dashes.
- If asked something outside this desk's work, say briefly what you can do instead.`;

function describeContext(input: {
  attached: { id: string; name: string; folder: string }[];
  folders: string[];
  runs: Awaited<ReturnType<typeof runsForSession>>;
  questions: Awaited<ReturnType<typeof openQuestions>>;
}) {
  const parts: string[] = [];
  if (input.attached.length > 0) {
    parts.push(
      `Attached to this message:\n${input.attached.map((item) => `- ${item.name} (id ${item.id}, folder "${item.folder}")`).join("\n")}`,
    );
  }
  const live = input.runs
    .filter((run) => run.status !== "completed" && run.status !== "failed")
    .slice(0, 3);
  if (live.length > 0) {
    parts.push(
      `Runs in progress:\n${live.map((run) => `- ${run.id}: ${run.pipeline ?? run.jobs.join(", ")} (${run.status})`).join("\n")}`,
    );
  }
  if (input.questions.length > 0) {
    parts.push(
      `Open questions waiting for the person:\n${input.questions
        .map(
          (question) =>
            `- questionId ${question.id}: "${question.prompt}"${question.wants.kinds.length ? ` (wants ${question.wants.kinds.map(kindLabel).join(" or ")})` : ""}${question.wants.options.length ? ` (options: ${question.wants.options.map((option) => option.value).join(", ")})` : ""}`,
        )
        .join("\n")}`,
    );
  }
  const last = input.runs.find((run) => run.status === "completed");
  if (last?.state?.decision) {
    parts.push(`Last finished run ${last.id}: ${last.state.decision.headline}`);
  }
  parts.push(`Cabinet folders: ${input.folders.join("; ")}`);
  return parts.join("\n\n");
}

/** Handles one message: the Specialist reads it, calls MCP tools, and replies. */
export async function* chat(
  session: SessionRow,
  input: { text: string; documentIds: string[]; origin: string },
): AsyncGenerator<ChatEvent> {
  const [attachedRows, folders, runs, history] = await Promise.all([
    documentsByIds(input.documentIds, session.id),
    loadCaseFiles(),
    runsForSession(session.id),
    loadMessages(session.id, 16),
  ]);
  const questions = await openQuestions(runs.map((run) => run.id));
  const folderTitle = new Map(
    folders.map((folder) => [folder.slug, folder.title]),
  );
  const attached = attachedRows.map((row) => ({
    id: row.id,
    name: row.name,
    folder: row.case_file_slug
      ? (folderTitle.get(row.case_file_slug) ?? "")
      : "Uploads",
  }));

  const text =
    input.text ||
    (attached.length > 0 ? "(dropped these documents without a note)" : "");
  await addMessage({
    sessionId: session.id,
    role: "user",
    text: input.text,
    documentIds: attached.map((item) => item.id),
  });

  // The desk speaks real MCP to its own server, without leaving the process.
  const mcp = await createMCPClient({
    transport: {
      type: "http",
      url: `${input.origin}/api/casework/mcp`,
      headers: { authorization: `Bearer ${sessionToken(session.id)}` },
      fetch: (url, init) => mcpHandler(new Request(url, init)),
    },
  });

  const settings = (await settingsFor(session)).chat;
  const started = Date.now();
  const toolCalls: { name: string; input: unknown; output?: unknown }[] = [];
  let reply = "";
  let runId: string | null = null;
  try {
    // @ai-sdk/mcp pins a newer provider-utils patch than ai; the tool shape is the same.
    const tools = (await mcp.tools()) as unknown as ToolSet;
    const messages: ModelMessage[] = [
      ...history.slice(-12).map(
        (message): ModelMessage => ({
          role: message.role === "user" ? "user" : "assistant",
          content: message.text || "(documents only)",
        }),
      ),
      {
        role: "user",
        content: `${describeContext({ attached, folders: folders.map((folder) => folder.title), runs, questions })}\n\nMessage: ${text}`,
      },
    ];
    const result = streamText({
      ...callOptions(settings),
      instructions: INSTRUCTIONS,
      messages,
      tools,
      stopWhen: isStepCount(4),
    });
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        reply += part.text;
        yield { type: "delta", text: part.text };
      } else if (part.type === "tool-call") {
        toolCalls.push({ name: part.toolName, input: part.input });
        yield { type: "tool", name: part.toolName, input: part.input };
      } else if (part.type === "tool-result") {
        const output = part.output as {
          structuredContent?: { runId?: string };
          content?: { text?: string }[];
          isError?: boolean;
        };
        const found = output?.structuredContent?.runId;
        if (found && part.toolName !== "get_run") runId = found;
        const call = toolCalls.findLast((item) => item.name === part.toolName);
        if (call) call.output = output?.structuredContent ?? null;
        yield {
          type: "tool-result",
          name: part.toolName,
          ok: !output?.isError,
          summary: output?.content?.[0]?.text?.slice(0, 300) ?? "",
          runId: found,
        };
      } else if (part.type === "tool-error") {
        yield {
          type: "tool-result",
          name: part.toolName,
          ok: false,
          summary: String(part.error).slice(0, 300),
        };
      } else if (part.type === "error") {
        throw part.error instanceof Error
          ? part.error
          : new Error(String(part.error));
      }
    }
    const steps = await result.steps;
    let costUsd = 0;
    for (const step of steps) {
      const cost = await trackCall({
        purpose: "chat",
        model: settings.model,
        usage: step.usage,
        providerMetadata: step.providerMetadata,
        started,
        sessionId: session.id,
        runId,
      });
      costUsd += cost.costUsd;
    }
    yield { type: "cost", costUsd, model: settings.model };
  } finally {
    await mcp.close();
  }

  const messageId = await addMessage({
    sessionId: session.id,
    role: "specialist",
    text: reply.trim(),
    runId,
    toolCalls,
  });
  yield { type: "done", messageId };
}
