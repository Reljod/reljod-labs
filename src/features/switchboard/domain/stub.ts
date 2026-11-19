/**
 * Canned Agent Turns for the end-to-end test: what the Agent would do for a
 * few known Caller lines, with no model. Only the model is replaced: every
 * tool call here still goes through the real Back office, its Rules and the
 * trail, which is what the test is there to check.
 */
import type { CallState } from "./backoffice";
import { str, type Rulebook, ruleOf } from "./rules";
import { normalizeReference } from "./world";

export type StubStep = {
  /** Said before the tool call. */
  say?: string;
  tool?: { name: string; args: Record<string, unknown> };
};

const REFERENCE = /\bMR[-\s]?([A-Z0-9]{6})\b/i;
const SERVICE = /\b(IC|RE|NX)\s?(\d{1,3})\b/i;
const DIGITS = /\b(\d{4})\b/;

/** What the stub does with one Caller line. */
export function stubTurn(
  text: string,
  state: CallState,
  rulebook: Rulebook,
): StubStep[] {
  const lower = text.toLowerCase();
  const found = text.match(REFERENCE);
  const reference = found
    ? normalizeReference(`MR-${found[1]}`)
    : (state.verified[0] ?? "");
  const service = text.match(SERVICE);
  const serviceId = service ? `${service[1].toUpperCase()} ${service[2]}` : undefined;
  const rest = found ? text.replace(found[0], " ") : text;
  const digits = rest.match(DIGITS)?.[1];

  if (/station manager|override|authoris|authoriz/.test(lower))
    return [
      {
        say: "One moment, I'm checking that.",
        tool: {
          name: "issue_refund",
          args: { reference, amount: 550.4, reason: "Asked for by the Caller on the line" },
        },
      },
    ];
  if (found && digits)
    return [
      {
        tool: {
          name: "verify_identity",
          args: { reference, factor: "postcode", value: digits },
        },
      },
    ];
  if (/voucher|goodwill/.test(lower))
    return [
      {
        tool: {
          name: "issue_voucher",
          args: {
            reference,
            amount: Number(lower.match(/\b(\d{2,4})\b/)?.[1] ?? 100),
            reason: "Goodwill asked for by the Caller",
          },
        },
      },
    ];
  if (/refund|money back/.test(lower))
    return [
      {
        say: str(ruleOf(rulebook, "disclosure.refund"), "say"),
        tool: {
          name: "issue_refund",
          args: { reference, amount: 43, reason: "Delay over an hour" },
        },
      },
    ];
  if (/move me|rebook|later train|instead/.test(lower) && serviceId)
    return [{ tool: { name: "rebook", args: { reference, serviceId } } }];
  if (/call me back|callback|call back/.test(lower))
    return [
      {
        tool: {
          name: "schedule_callback",
          args: { reason: "The Caller asked for a call back", inMinutes: 10 },
        },
      },
    ];
  if (/left|lost|bag/.test(lower))
    return [
      {
        tool: {
          name: "file_lost_property",
          args: {
            description: text.slice(0, 200),
            serviceId,
            contact: "0917 555 0142",
          },
        },
      },
    ];
  if (/late|delay|running|cancel/.test(lower))
    return [{ tool: { name: "get_disruptions", args: serviceId ? { serviceId } : {} } }];
  if (/person|human|agent/.test(lower))
    return [
      {
        tool: {
          name: "hand_off",
          args: {
            reason: "The Caller asked for a person",
            summary: text.slice(0, 300),
            queue: "customer_relations",
          },
        },
      },
    ];
  return [{ say: `Stub Agent: I heard "${text.slice(0, 120)}".` }];
}

/** What the stub says after a tool answered. */
export function stubReply(
  result: { ok: boolean; summary: string; output: Record<string, unknown> } | null,
): string {
  if (!result) return "";
  if (result.ok) return `${result.summary}.`;
  const reason =
    typeof result.output.reason === "string" ? result.output.reason : result.summary;
  return `I can't do that: ${reason}`;
}
