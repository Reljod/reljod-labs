import { z } from "zod";

/*
 * What the pipeline reads out of a Recording. The zod schemas are what the
 * models are asked to fill; the types are what the rest of the feature uses.
 * Times are seconds from the start of the Recording.
 */

/** One moment of the call: what was said and what the shared screen showed. */
export const observationSchema = z.object({
  at: z.number().min(0).describe("Seconds from the start of the recording"),
  speaker: z
    .string()
    .nullable()
    .describe("Who is speaking, by name if known, else null"),
  said: z.string().describe("What was said, close to verbatim"),
  shown: z
    .string()
    .describe(
      "What the shared screen shows or what was clicked or typed; empty if nothing changed",
    ),
});
export type Observation = z.infer<typeof observationSchema>;

/** The Watch stage's output: the call, moment by moment. */
export const watchSchema = z.object({
  title: z.string().describe("A short name for what the call is about"),
  durationSeconds: z.number().min(0),
  participants: z.array(
    z.object({
      name: z.string(),
      role: z.string().describe("Their job or their part in the call"),
    }),
  ),
  observations: z.array(observationSchema),
});
export type Watch = z.infer<typeof watchSchema>;

export const decisionSchema = z.object({
  question: z.string().describe("The question that decides the path"),
  branches: z.array(
    z.object({
      when: z.string().describe("The condition, e.g. 'Variance above 50 MRD'"),
      // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
      then: z.string().describe("What to do in that case"),
    }),
  ),
});
export type Decision = z.infer<typeof decisionSchema>;

export const processStepSchema = z.object({
  id: z.string().describe("s1, s2, ... in order"),
  title: z
    .string()
    .describe("Starts with a verb, at most 8 words: 'Open the remittance'"),
  actor: z.string().describe("The role that does this step"),
  system: z
    .string()
    .nullable()
    .describe("The application or screen it happens in, null if none"),
  action: z
    .string()
    .describe("What to do, in one to three plain sentences, as an instruction"),
  details: z
    .array(z.string())
    .describe("Fields, values, menu paths or checks worth writing down"),
  at: z
    .number()
    .min(0)
    .describe("Seconds into the recording where this step is shown"),
  warning: z
    .string()
    .nullable()
    .describe("A pitfall the presenter warned about, else null"),
  decision: decisionSchema.nullable(),
});
export type ProcessStep = z.infer<typeof processStepSchema>;

/** The Process: the procedure the call hands over, ready to be written up. */
export const processSchema = z.object({
  title: z.string(),
  purpose: z.string().describe("Why the process exists, one or two sentences"),
  scope: z.string().describe("What it covers and what it does not"),
  trigger: z.string().describe("What starts it"),
  frequency: z.string().nullable().describe("How often it runs, if said"),
  owner: z.string().describe("Who hands it over (name and role)"),
  receiver: z.string().describe("Who takes it over (name and role)"),
  roles: z.array(z.object({ name: z.string(), responsibility: z.string() })),
  systems: z.array(z.object({ name: z.string(), usedFor: z.string() })),
  prerequisites: z.array(z.string()),
  steps: z.array(processStepSchema),
  exceptions: z.array(
    z.object({ situation: z.string(), handling: z.string() }),
  ),
  controls: z
    .array(z.string())
    .describe("Approvals, limits and checks that keep it safe"),
  glossary: z.array(z.object({ term: z.string(), meaning: z.string() })),
  openQuestions: z
    .array(z.string())
    .describe("Things the call left unanswered or promised to confirm"),
});
export type Process = z.infer<typeof processSchema>;

/** `m:ss`, for showing a time in the Recording. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
