import "server-only";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  hasToolCall,
  isStepCount,
  type ModelMessage,
  streamText,
  type ToolSet,
  tool,
} from "ai";
import { z } from "zod";
import {
  ASK_TOOL,
  type ChatEvent,
  type ChoiceOption,
} from "../domain/chat-events";
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
  touchSession,
} from "./repository";
import { settingsFor, stopActiveRun } from "./runs";
import { sessionToken } from "./session";

const INSTRUCTIONS = `You are the Specialist at the pension and onboarding desk of Corallis Trust & Pensions, a fictional bank and trust company in the Republic of Meridia. You run review work through tools on the Casework MCP server: four pipelines and the single jobs they are built from.

Pipelines:
${PIPELINE_IDS.map((id) => `- pipeline_${id}: ${PIPELINES[id].title}. ${PIPELINES[id].blurb}.`).join("\n")}

Jobs (each runs alone, with whatever it depends on first):
${Object.entries(JOBS)
  .map(([id, job]) => `- job_${id}: ${job.title}`)
  .join("\n")}

Before you start anything, check that you have enough to go on. You need two things:
1. Documents. They are attached to the message, or the person named a folder, person or company you can look up with find_documents. Never invent ids.
2. What to do with them. Either a review (a pipeline, or review_documents when they did not say which) or one named step (a job).
Then call check_ready with the document ids. Start the job or pipeline only when it says ready.

When something is missing or check_ready says not ready, do not start anything and do not guess. Call ${ASK_TOOL} with one short question and 2 to 4 options the person can click. Examples: no documents ("Which case should I work on?" with a few Cabinet folders that fit), intent unclear ("What should I do with these?" with "Full review", "Just extract the fields", "Screen the names"), a run already going ("Stop the current run and start this one?" with "Stop and start", "Leave it running"). After ${ASK_TOOL}, stop and wait; add at most one short sentence.

Other rules:
- One step ("just extract", "screen these names", "reconcile this schedule") is a job, not a pipeline.
- If a run is waiting on a question and the message answers it (documents, a choice, "skip", "go on without it"), call answer_question with the open question's id.
- If the person says stop, cancel, abort or never mind while a run is going, call stop_run.
- Results stream onto the desk by themselves. Do not narrate them or guess outcomes.
- After starting a run, reply in one or two short sentences: what you started and what to watch for. No lists, no headings. Never use the em dash character; use a comma, a colon or a full stop.
- If asked something outside this desk's work, say briefly what you can do instead.`;

const STOP_WORDS =
  /^(please\s+)?(stop|cancel|abort|halt|kill)(\s+(it|that|this|everything|the\s+(run|job|jobs|pipeline|review)))?[\s.!]*$/i;

function describeContext(input: {
  attached: { id: string; name: string; folder: string }[];
  folders: string[];
  runs: Awaited<ReturnType<typeof runsForSession>>;
  questions: Awaited<ReturnType<typeof openQuestions>>;
}) {
  const parts: string[] = [];
  if (input.attached.length === 0) {
    parts.push("No documents are attached to this message.");
  }
  if (input.attached.length > 0) {
    parts.push(
      `Attached to this message:\n${input.attached.map((item) => `- ${item.name} (id ${item.id}, folder "${item.folder}")`).join("\n")}`,
    );
  }
  const live = input.runs
    .filter(
      (run) =>
        run.status === "queued" ||
        run.status === "running" ||
        run.status === "waiting",
    )
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
  input: {
    text: string;
    documentIds: string[];
    origin: string;
    /** Aborted when the person presses stop or leaves. */
    signal?: AbortSignal;
  },
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
  await touchSession(
    session,
    input.text || attached[0]?.folder || attached[0]?.name,
  );

  // "Stop" needs no model: it stops whatever is going, at once.
  if (STOP_WORDS.test(input.text.trim())) {
    const stopped = await stopActiveRun(session);
    const reply = stopped.stopped
      ? "Stopped. Nothing else will run."
      : "Nothing is running right now.";
    yield { type: "tool", name: "stop_run", input: {} };
    yield {
      type: "tool-result",
      name: "stop_run",
      ok: true,
      summary: reply,
      runId: stopped.runId ?? undefined,
    };
    yield { type: "delta", text: reply };
    const messageId = await addMessage({
      sessionId: session.id,
      role: "specialist",
      text: reply,
      runId: stopped.runId,
      toolCalls: [{ name: "stop_run", input: {}, ok: true, summary: reply }],
    });
    yield { type: "done", messageId };
    return;
  }

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
  const toolCalls: {
    name: string;
    input: unknown;
    output?: unknown;
    ok?: boolean;
    summary?: string;
  }[] = [];
  let reply = "";
  let runId: string | null = null;
  let aborted = false;
  try {
    // @ai-sdk/mcp pins a newer provider-utils patch than ai; the tool shape is the same.
    const tools: ToolSet = {
      ...((await mcp.tools()) as unknown as ToolSet),
      // Runs here, not on the MCP server: it only puts buttons in front of the person.
      [ASK_TOOL]: tool({
        description:
          "Asks the person one question with 2 to 4 options shown as buttons. Use it whenever you lack the documents or the intent to start work, or need them to choose. Their pick comes back as their next message.",
        inputSchema: z.object({
          question: z.string().max(200),
          options: z
            .array(
              z.object({
                label: z
                  .string()
                  .max(60)
                  .describe("The button text, also sent back as the reply"),
                detail: z
                  .string()
                  .max(120)
                  .optional()
                  .describe("One line on what picking it does"),
              }),
            )
            .min(2)
            .max(4),
        }),
        execute: async () => "Shown to the person. Wait for their reply.",
      }),
    };
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
      stopWhen: [isStepCount(6), hasToolCall(ASK_TOOL)],
      abortSignal: input.signal,
    });
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        reply += part.text;
        yield { type: "delta", text: part.text };
      } else if (part.type === "reasoning-delta") {
        yield { type: "reasoning", text: part.text };
      } else if (part.type === "abort") {
        aborted = true;
      } else if (part.type === "tool-call") {
        toolCalls.push({ name: part.toolName, input: part.input });
        if (part.toolName === ASK_TOOL) {
          const asked = part.input as {
            question: string;
            options: ChoiceOption[];
          };
          yield {
            type: "choices",
            question: asked.question,
            options: asked.options,
          };
        } else {
          yield { type: "tool", name: part.toolName, input: part.input };
        }
      } else if (part.type === "tool-result") {
        if (part.toolName === ASK_TOOL) continue;
        const output = part.output as {
          structuredContent?: { runId?: string };
          content?: { text?: string }[];
          isError?: boolean;
        };
        const found = output?.structuredContent?.runId;
        if (found && part.toolName !== "get_run") runId = found;
        const call = toolCalls.findLast((item) => item.name === part.toolName);
        const summary = output?.content?.[0]?.text?.slice(0, 300) ?? "";
        if (call) {
          call.output = output?.structuredContent ?? null;
          call.ok = !output?.isError;
          call.summary = summary;
        }
        yield {
          type: "tool-result",
          name: part.toolName,
          ok: !output?.isError,
          summary,
          runId: found,
        };
      } else if (part.type === "tool-error") {
        const summary = String(part.error).slice(0, 300);
        const call = toolCalls.findLast((item) => item.name === part.toolName);
        if (call) {
          call.ok = false;
          call.summary = summary;
        }
        yield {
          type: "tool-result",
          name: part.toolName,
          ok: false,
          summary,
        };
      } else if (part.type === "error") {
        throw part.error instanceof Error
          ? part.error
          : new Error(String(part.error));
      }
    }
    const steps = aborted ? [] : await result.steps;
    let costUsd = 0;
    // Latency is the whole message's, recorded once; each step still gets its own tokens and cost.
    for (const [index, step] of steps.entries()) {
      const cost = await trackCall({
        purpose: "chat",
        model: settings.model,
        usage: step.usage,
        providerMetadata: step.providerMetadata,
        started: index === 0 ? started : Date.now(),
        sessionId: session.id,
        runId,
      });
      costUsd += cost.costUsd;
    }
    if (!aborted) yield { type: "cost", costUsd, model: settings.model };
  } catch (error) {
    // Stopped mid-answer: keep what was said so far.
    if (!input.signal?.aborted) throw error;
    aborted = true;
  } finally {
    await mcp.close();
  }

  const messageId = await addMessage({
    sessionId: session.id,
    role: "specialist",
    text: aborted ? `${reply.trim()} (stopped)`.trim() : reply.trim(),
    runId,
    toolCalls,
  });
  yield { type: "done", messageId };
}
