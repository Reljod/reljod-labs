/**
 * The Back office tools: the one list the MCP server registers, the realtime
 * Session is given, and the text Line and outside clients call. A tool's name,
 * description and input schema are defined once, here.
 */
import { z } from "zod";
import { LIMITS } from "./limits";
import { IDENTITY_FACTORS, POLICY_TOPICS } from "./rules";
import { ASSISTANCE_KINDS } from "./world";

const reference = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .describe("The booking reference the Caller read out, like MR-7K2Q9F");

export const BACK_OFFICE_TOOLS = {
  get_disruptions: {
    title: "Today's disruptions",
    description:
      "Delays, cancellations and platform changes today. Public information: no identity check needed. Give a train number to see one train.",
    input: z.object({
      serviceId: z
        .string()
        .trim()
        .max(12)
        .optional()
        .describe("A train number like IC 418; leave out for all"),
    }),
    writes: false,
    needsIdentity: false,
  },
  find_booking: {
    title: "Find a booking",
    description:
      "Looks up a Booking by its reference. Until the Caller's identity is verified for it, the Back office withholds every detail.",
    input: z.object({ reference }),
    writes: false,
    needsIdentity: true,
  },
  verify_identity: {
    title: "Verify identity",
    description:
      "Checks the Caller's second factor against the Booking. Call it with exactly what the Caller said; the Back office compares. Never guess a value.",
    input: z.object({
      reference,
      factor: z
        .enum(
          IDENTITY_FACTORS.map((item) => item.value) as [string, ...string[]],
        )
        .describe("Which second factor the Caller gave"),
      value: z.string().trim().min(1).max(120).describe("What the Caller said"),
    }),
    writes: false,
    needsIdentity: false,
  },
  rebooking_options: {
    title: "Rebooking options",
    description:
      "Later trains today on the same line as the Booking, with how each is running.",
    input: z.object({ reference }),
    writes: false,
    needsIdentity: true,
  },
  rebook: {
    title: "Rebook",
    description:
      "Moves the Booking to another train on the same line today, at no charge.",
    input: z.object({
      reference,
      serviceId: z.string().trim().min(2).max(12).describe("The new train"),
    }),
    writes: true,
    needsIdentity: true,
  },
  issue_refund: {
    title: "Issue a refund",
    description:
      "Refunds part or all of the fare. The Back office works out what is due and applies the limits; ask for the amount the Caller wants and report what it answers.",
    input: z.object({
      reference,
      amount: z.number().positive().max(10_000).describe("Amount in MRD"),
      reason: z.string().trim().min(3).max(300),
    }),
    writes: true,
    needsIdentity: true,
  },
  issue_voucher: {
    title: "Issue a goodwill voucher",
    description: "Adds a goodwill voucher to the Booking, within the limit.",
    input: z.object({
      reference,
      amount: z.number().positive().max(1000).describe("Amount in MRD"),
      reason: z.string().trim().min(3).max(300),
    }),
    writes: true,
    needsIdentity: true,
  },
  file_lost_property: {
    title: "File lost property",
    description:
      "Files a lost property report. No identity check needed: it holds only what the Caller tells you.",
    input: z.object({
      description: z.string().trim().min(3).max(300),
      serviceId: z.string().trim().max(12).optional().describe("The train"),
      where: z
        .string()
        .trim()
        .max(120)
        .optional()
        .describe("Coach, seat or station where it was left"),
      contact: z
        .string()
        .trim()
        .min(3)
        .max(160)
        .describe("How to reach the Caller: a phone number or an email"),
    }),
    writes: true,
    needsIdentity: false,
  },
  book_assistance: {
    title: "Book assistance",
    description:
      "Books help at a station on the Booking's route: a ramp, a wheelchair, a sighted guide or help with luggage.",
    input: z.object({
      reference,
      station: z.string().trim().min(2).max(60),
      kind: z.enum(ASSISTANCE_KINDS),
      notes: z.string().trim().max(300).optional(),
    }),
    writes: true,
    needsIdentity: true,
  },
  schedule_callback: {
    title: "Schedule a callback",
    description: `Promises the Caller a call back. The line calls back after the Call ends; at most ${LIMITS.callbackMaxMinutes} minutes later.`,
    input: z.object({
      reason: z.string().trim().min(3).max(300),
      inMinutes: z.number().int().min(1).max(600),
      reference: reference.optional(),
    }),
    writes: true,
    needsIdentity: false,
  },
  hand_off: {
    title: "Hand off to a person",
    description:
      "Passes the Call to a person, with why and a summary they can act on without asking again. Always allowed.",
    input: z.object({
      reason: z.string().trim().min(3).max(200),
      summary: z.string().trim().min(3).max(600),
      queue: z
        .enum(["customer_relations", "safety", "accessibility", "duty_manager"])
        .describe("Who should take it"),
    }),
    writes: true,
    needsIdentity: false,
  },
  read_policy: {
    title: "Read a policy",
    description:
      "Meridia Rail's own words on a topic. Read it before explaining a policy rather than answering from memory.",
    input: z.object({
      topic: z.enum(
        POLICY_TOPICS.map((item) => item.value) as [string, ...string[]],
      ),
    }),
    writes: false,
    needsIdentity: false,
  },
} as const;

export type BackOfficeToolName = keyof typeof BACK_OFFICE_TOOLS;

export const BACK_OFFICE_TOOL_NAMES = Object.keys(
  BACK_OFFICE_TOOLS,
) as BackOfficeToolName[];

export function isBackOfficeTool(name: string): name is BackOfficeToolName {
  return name in BACK_OFFICE_TOOLS;
}

/** Plain words for a tool call in the transcript: "Looking up the booking". */
export const TOOL_DOING: Record<BackOfficeToolName, string> = {
  get_disruptions: "Checking today's disruptions",
  find_booking: "Looking up the booking",
  verify_identity: "Checking identity",
  rebooking_options: "Finding later trains",
  rebook: "Moving the booking",
  issue_refund: "Issuing a refund",
  issue_voucher: "Adding a goodwill voucher",
  file_lost_property: "Filing a lost property report",
  book_assistance: "Booking assistance",
  schedule_callback: "Scheduling a callback",
  hand_off: "Handing off to a person",
  read_policy: "Reading the policy",
};

/** The path of the MCP server. */
export const SWITCHBOARD_MCP_PATH = "/api/switchboard/mcp";
