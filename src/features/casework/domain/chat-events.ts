/** What the chat route streams back for one message, one JSON object per line. */
export type ChatEvent =
  | { type: "delta"; text: string }
  /** The model thinking out loud before it answers or calls a tool. */
  | { type: "reasoning"; text: string }
  /** The Specialist asks the person to pick; each option is sent back as a message. */
  | { type: "choices"; question: string; options: ChoiceOption[] }
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

export type ChoiceOption = {
  label: string;
  /** One line on what picking it does. */
  detail?: string;
};

/** The tool the Specialist calls to offer choices; it runs in the chat, not on the MCP server. */
export const ASK_TOOL = "ask_person";

export const MAX_MESSAGE_LENGTH = 800;
