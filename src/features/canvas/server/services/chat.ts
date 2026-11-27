import "server-only";
import type { Access } from "@/features/access/server/gate";
import { InvalidError, LimitError, NotFoundError } from "@/platform/errors";
import { type ChatEvent, partsOf, titleOf } from "../../domain/chat";
import { analystInstructions } from "../../domain/instructions";
import { LIMITS } from "../../domain/limits";
import type { TrailUsage } from "../../domain/trail";
import type {
  Analyst,
  AnalystTurn,
  Caller,
  CanvasRate,
  ConversationRepository,
  McpConnector,
  TrailRepository,
} from "../ports";
import type { ConnectService } from "./connect";
import type { RuleService } from "./rules";
import type { ViewService } from "./views";

/*
 * A Question (ADR 0031): taken from the visitor's hourly allowance before
 * anything is filed or any model is called, filed in its Conversation, then
 * answered by the Analyst through the Canvas MCP server. The harness, not
 * the model, owns the caps (turns, USD, Sandbox time) and what is saved:
 * whatever ends a turn (an answer, a cap, Stop, an error), what was done is
 * saved as the Analyst's message and recorded on the Trail.
 */

export interface ChatService {
  /**
   * Resolves once the Question is past its limits and filed (a refusal
   * throws before anything streams); then the turn's events stream, the
   * first being where it was filed.
   */
  ask(
    access: Access,
    caller: Caller,
    input: { text: string; conversationId?: string },
    watch: { origin: string; signal: AbortSignal },
  ): Promise<AsyncGenerator<ChatEvent>>;
}

function totals(
  model: string,
  calls: TrailUsage[],
  sandboxMs: number,
): Extract<ChatEvent, { type: "usage" }> {
  return {
    type: "usage",
    model,
    turns: calls.length,
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
    sandboxMs,
  };
}

export function createChatService(ports: {
  rate: CanvasRate;
  conversations: ConversationRepository;
  rules: Pick<RuleService, "current">;
  views: Pick<ViewService, "list">;
  connect: Pick<ConnectService, "shortToken">;
  analyst: Analyst;
  mcp: McpConnector;
  trail: TrailRepository;
}): ChatService {
  const { conversations, analyst, trail } = ports;

  async function* answer(
    access: Access,
    caller: Caller & { conversationId: string; questionId: string },
    text: string,
    watch: { origin: string; signal: AbortSignal },
  ): AsyncGenerator<ChatEvent> {
    const events: ChatEvent[] = [];
    const spent = { calls: [] as TrailUsage[] };
    const model = analyst.model();
    const turn: AnalystTurn = {
      text,
      signal: watch.signal,
      connect: () =>
        ports.mcp({
          token: ports.connect.shortToken(access, caller, "chat"),
          origin: watch.origin,
          clientName: "canvas-analyst",
        }),
      async prepare() {
        const [rulebook, views, history] = await Promise.all([
          ports.rules.current(caller.owner),
          ports.views.list(caller.owner, caller.conversationId),
          conversations.messages(caller.owner, caller.conversationId),
        ]);
        return { system: analystInstructions(rulebook, views), history };
      },
      async onModelCall(usage, detail) {
        await trail.record(caller, {
          actor: "analyst",
          action: "model.called",
          summary: `Turn ${spent.calls.length}: ${usage.inputTokens} in, ${usage.outputTokens} out`,
          detail,
          usage,
        });
      },
    };
    let failed: string | null = null;

    /**
     * Saves the answer and its Trail event, once. Run from `finally` too: a
     * visitor who leaves closes the stream (the generator is returned at a
     * `yield`), and what was done must still be saved.
     */
    let settled: Promise<{
      usage: Extract<ChatEvent, { type: "usage" }>;
      messageId: string | null;
    }> | null = null;
    const settle = () => {
      settled ??= (async () => {
        const stopped = watch.signal.aborted;
        if (stopped) events.push({ type: "notice", text: "Stopped." });
        const usage = totals(
          model,
          spent.calls,
          await conversations
            .sandboxMs(caller.owner, caller.questionId)
            .catch(() => 0),
        );
        const content = events
          .filter((event) => event.type === "text.delta")
          .map((event) => event.text)
          .join("")
          .trim();
        const { type: _type, ...kept } = usage;
        const messageId = await conversations
          .fileAnswer(caller, { content, parts: partsOf(events), usage: kept })
          .catch(() => null);
        await trail
          .record(caller, {
            action:
              stopped || failed ? "question.stopped" : "question.answered",
            summary: `${stopped ? "Stopped" : failed ? "Failed" : "Answered"} in ${usage.turns} turn${usage.turns === 1 ? "" : "s"}, ${events.filter((event) => event.type === "view").length} View(s), $${(usage.costUsd ?? 0).toFixed(4)}`,
            detail: {
              model,
              turns: usage.turns,
              sandboxMs: usage.sandboxMs,
              tools: events.filter((event) => event.type === "tool.started")
                .length,
              stub: model === "stub",
              // The tokens and cost are on each turn's own `model.called` event.
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              costUsd: usage.costUsd ?? 0,
            },
          })
          .catch(() => {});
        return { usage, messageId };
      })();
      return settled;
    };

    try {
      try {
        for await (const event of analyst.answer(turn, spent)) {
          // A tool call as it streams in, and running totals, are not kept.
          if (event.type !== "tool.building" && event.type !== "usage")
            events.push(event);
          yield event;
        }
      } catch (error) {
        if (!watch.signal.aborted) {
          console.error(
            "[canvas] turn failed",
            error instanceof Error ? error.message : error,
          );
          failed = "The Analyst could not finish. Try the Question again.";
        }
      }
      const { usage, messageId } = await settle();
      yield usage;
      if (failed) yield { type: "error", message: failed };
      yield { type: "done", messageId };
    } finally {
      await settle();
    }
  }

  return {
    async ask(access, caller, input, watch) {
      const text = input.text.trim();
      if (!text) throw new InvalidError("Ask a Question first.");
      // Taken before anything is filed or any model is called.
      await ports.rate.take("question", caller.visitor, {
        owner: caller.owner,
      });
      const filed = await conversations.fileQuestion(
        caller,
        {
          conversationId: input.conversationId,
          text,
          title: titleOf(text),
        },
        (open) => {
          if (open >= LIMITS.conversationsPerOwner)
            throw new LimitError(
              `You can keep ${LIMITS.conversationsPerOwner} Conversations. Delete one first.`,
            );
        },
        (at, started) => [
          ...(started
            ? [
                {
                  action: "conversation.started" as const,
                  summary: `Conversation started: ${at.title}`,
                  detail: { title: at.title },
                },
              ]
            : []),
          {
            action: "question.asked" as const,
            summary: text.replace(/\s+/g, " ").slice(0, 200),
            detail: { text },
          },
        ],
      );
      if (!filed) throw new NotFoundError("No such Conversation.");
      const turnCaller = {
        ...caller,
        conversationId: filed.conversationId,
        questionId: filed.questionId,
      };
      return (async function* () {
        yield { type: "question", ...filed } satisfies ChatEvent;
        yield* answer(access, turnCaller, text, watch);
      })();
    },
  };
}
