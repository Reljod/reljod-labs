/** What the chat route streams back for one message, one JSON object per line. */
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | {
      type: "tool-result";
      name: string;
      ok: boolean;
      summary: string;
      runId?: string;
    }
  | { type: "cost"; costUsd: number; model: string }
  | { type: "done"; messageId: number }
  | { type: "error"; message: string };

export const MAX_MESSAGE_LENGTH = 800;
