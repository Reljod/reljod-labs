/** Questions offered as chips beside the chat box. */
export const PRESET_QUESTIONS = [
  "Where has Reljod worked?",
  "What did he build for KYC?",
  "What services does he offer?",
  "Show me his projects",
  "How does he run an AI project?",
  "How do I book a call?",
] as const;

export const MAX_QUESTION_LENGTH = 300;

/** Trims and caps a visitor's question; empty means there is nothing to ask. */
export function cleanQuestion(question: string) {
  return question.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_LENGTH);
}
