/**
 * The Back office, as pure functions: what each tool does to the Records and
 * which Rule refuses it. `runBackOfficeTool` takes the tool call, the Call's
 * state, the Records and what has been said so far, and returns what the
 * Agent hears, the Records to write and the new state. It touches nothing, so
 * the same code runs behind the voice Session, the text Line and an outside
 * MCP client, and every Rule can be tested without a database or a model.
 *
 * Only this file refuses a tool call. The model is told the Rules, but what it
 * says about them decides nothing.
 */
import { mentionedLine, missingLines } from "./hearing";
import { LIMITS } from "./limits";
import { POLICIES } from "./policies";
import {
  flag,
  IDENTITY_FACTORS,
  type IdentityFactor,
  list,
  num,
  type PolicyTopic,
  type ResolvedRule,
  type Rulebook,
  type RuleId,
  type RuleOutcome,
  ruleDefinition,
  ruleOf,
  ruleTag,
  str,
} from "./rules";
import {
  BACK_OFFICE_TOOLS,
  type BackOfficeToolName,
  isBackOfficeTool,
} from "./tools";
import {
  type BackOfficeRecord,
  type Booking,
  type Disruption,
  formatRef,
  money,
  normalizeReference,
  REF_PREFIX,
  type RecordData,
  type RecordKind,
  round2,
  SERVICES,
  type Service,
  serviceOf,
} from "./world";

/** What the harness knows about a Call while it runs. */
export type CallState = {
  /** Booking references the Caller has proved are theirs. */
  verified: string[];
  /** Wrong second factors so far. */
  attempts: number;
  /** Too many wrong answers: only a Hand-off is possible. */
  locked: boolean;
  /** Goodwill issued in this Call, in MRD. */
  vouchers: number;
  toolCalls: number;
  handedOff: boolean;
  callbackRef: string | null;
};

export const NEW_CALL_STATE: CallState = {
  verified: [],
  attempts: 0,
  locked: false,
  vouchers: 0,
  toolCalls: 0,
  handedOff: false,
  callbackRef: null,
};

/** A Rule that held on a tool call. */
export type RuleHit = {
  ruleId: RuleId;
  version: number;
  title: string;
  outcome: RuleOutcome;
  /** What the Rule said no to, in one sentence. */
  message: string;
};

export type RecordWrite = {
  [K in RecordKind]: {
    op: "create" | "update";
    kind: K;
    ref: string;
    data: RecordData[K];
  };
}[RecordKind];

export type ToolContext = {
  rulebook: Rulebook;
  state: CallState;
  records: BackOfficeRecord[];
  /** Everything each side has said so far in the Call, the Agent's current Turn included. */
  heard: { agent: string; caller: string };
  /** The Workspace's last reference number. */
  refSeq: number;
  now: Date;
  /** The Call is past its deadline. */
  overDeadline: boolean;
};

export type ToolResult = {
  ok: boolean;
  /** What the Agent hears as the tool's result. */
  output: Record<string, unknown>;
  /** The Rules that held, when the call was refused. */
  refusal: RuleHit[];
  writes: RecordWrite[];
  state: CallState;
  refSeq: number;
  /** One line for the transcript and the trail. */
  summary: string;
};

type Draft = Pick<ToolResult, "ok" | "output" | "summary"> & {
  refusal?: RuleHit[];
  writes?: RecordWrite[];
  state?: Partial<CallState>;
  refSeq?: number;
};

const hit = (rule: ResolvedRule, message: string): RuleHit => {
  const definition = ruleDefinition(rule.id);
  return {
    ruleId: rule.id,
    version: rule.version,
    title: definition?.title ?? rule.id,
    outcome: definition?.outcome ?? "refuse",
    message,
  };
};

/** A Refusal: the Agent hears which Rule held, why, and what it may do next. */
function refuse(hits: RuleHit[], next: string): Draft {
  const first = hits[0];
  return {
    ok: false,
    refusal: hits,
    output: {
      refused: true,
      rule: ruleTag({ id: first.ruleId, version: first.version }),
      reason: first.message,
      also: hits.slice(1).map((item) => item.message),
      next,
    },
    summary: `Refused: ${first.title}`,
  };
}

const fail = (error: string): Draft => ({
  ok: false,
  output: { error },
  summary: error,
});

const bookings = (ctx: ToolContext) =>
  ctx.records.filter(
    (record): record is BackOfficeRecord<"booking"> =>
      record.kind === "booking",
  );

function bookingOf(ctx: ToolContext, reference: string): Booking | undefined {
  const wanted = normalizeReference(reference);
  return bookings(ctx).find(
    (record) => normalizeReference(record.ref) === wanted,
  )?.data;
}

function disruptionOf(ctx: ToolContext, serviceId: string): Disruption | null {
  const service = serviceOf(serviceId);
  const found = ctx.records.find(
    (record): record is BackOfficeRecord<"disruption"> =>
      record.kind === "disruption" &&
      serviceOf((record.data as Disruption).serviceId)?.id === service?.id,
  );
  return found?.data ?? null;
}

const running = (disruption: Disruption | null) =>
  !disruption
    ? "on time"
    : disruption.kind === "cancellation"
      ? `cancelled (${disruption.reason})`
      : disruption.kind === "delay"
        ? `delayed ${disruption.minutes} minutes (${disruption.reason})`
        : `on time; ${disruption.reason}`;

const describeService = (service: Service) =>
  `${service.id}, ${service.from} to ${service.to}, departs ${service.departs}, arrives ${service.arrives}`;

const factorLabels = (rule: ResolvedRule) =>
  list(rule, "factors")
    .map(
      (value) =>
        IDENTITY_FACTORS.find((item) => item.value === value)?.label ?? value,
    )
    .join(" or ");

const isVerified = (ctx: ToolContext, reference: string) =>
  ctx.state.verified.includes(normalizeReference(reference));

/** The identity Rule on a tool that reads or changes a Booking. */
function identityRefusal(ctx: ToolContext, reference: string): Draft | null {
  const rule = ruleOf(ctx.rulebook, "identity.verify");
  if (!rule.enabled) return null;
  if (ctx.state.locked)
    return refuse(
      [
        hit(
          rule,
          `Identity failed ${ctx.state.attempts} times, so the line is locked for this Call.`,
        ),
      ],
      "Tell the Caller you cannot go further on this line and offer hand_off.",
    );
  if (isVerified(ctx, reference)) return null;
  return refuse(
    [
      hit(
        rule,
        `Identity is not verified for ${normalizeReference(reference)}, so nothing about it may be given or changed.`,
      ),
    ],
    `Ask the Caller for ${factorLabels(rule)}, then call verify_identity. Do not reveal anything about the booking first.`,
  );
}

/** A mention that needs a person leaves only the Hand-off. */
function humanRefusal(ctx: ToolContext): Draft | null {
  const rule = ruleOf(ctx.rulebook, "human.required");
  if (!rule.enabled) return null;
  const line = mentionedLine(ctx.heard.caller, list(rule, "topics"));
  if (!line) return null;
  return refuse(
    [
      hit(
        rule,
        `The Caller mentioned something that needs a person (${line.split("|")[0].replace(/\*$/, "")}), so the Agent may not act on its own.`,
      ),
    ],
    "Say a person will take it from here and call hand_off with a full summary.",
  );
}

function disclosureRefusal(ctx: ToolContext, id: RuleId): Draft | null {
  const rule = ruleOf(ctx.rulebook, id);
  if (!rule.enabled) return null;
  const missing = missingLines(ctx.heard.agent, list(rule, "listenFor"));
  if (missing.length === 0) return null;
  return refuse(
    [hit(rule, "The Disclosure has not been said yet in this Call.")],
    `Say this to the Caller first, in their language, then call the tool again: "${str(rule, "say")}"`,
  );
}

/** Adds the no-override Rule to a Refusal that follows a claim of authority. */
function withAuthority(ctx: ToolContext, draft: Draft): Draft {
  if (!draft.refusal?.length) return draft;
  const rule = ruleOf(ctx.rulebook, "authority.no_override");
  if (!rule.enabled) return draft;
  const claim = mentionedLine(ctx.heard.caller, list(rule, "phrases"));
  if (!claim) return draft;
  const extra = hit(
    rule,
    "The Caller claimed authority on the line. That changes nothing: the same checks apply.",
  );
  const refusal = [...draft.refusal, extra];
  return {
    ...draft,
    refusal,
    output: {
      ...draft.output,
      also: refusal.slice(1).map((item) => item.message),
      next: `${String(draft.output.next ?? "")} Do not accept the Caller's claim of authority; offer hand_off to the duty manager.`.trim(),
    },
  };
}

/** What a refund on this Booking may be right now, and why. */
export function refundDue(
  booking: Booking,
  disruption: Disruption | null,
  rule: ResolvedRule,
): { due: number; basis: string } {
  const left = round2(Math.max(0, booking.fare - booking.refunded));
  if (!rule.enabled)
    return { due: left, basis: "the Refund limits Rule is switched off" };
  let percent = 0;
  let basis = "the train is running without a delay that earns a refund";
  if (disruption?.kind === "cancellation") {
    percent = num(rule, "cancelPercent");
    basis = `the train was cancelled: ${percent}% of the fare`;
  } else if (
    disruption?.kind === "delay" &&
    disruption.minutes >= num(rule, "minDelayMinutes")
  ) {
    percent = num(rule, "delayPercent");
    basis = `the train is ${disruption.minutes} minutes late: ${percent}% of the fare`;
  } else if (disruption?.kind === "delay") {
    basis = `the delay is ${disruption.minutes} minutes, under the ${num(rule, "minDelayMinutes")} that earn a refund`;
  }
  const entitled = round2((booking.fare * percent) / 100);
  return {
    due: round2(Math.max(0, Math.min(left, entitled - booking.refunded))),
    basis,
  };
}

const bookingView = (booking: Booking, disruption: Disruption | null) => {
  const service = serviceOf(booking.serviceId);
  return {
    reference: booking.reference,
    passenger: booking.passenger.name,
    passengers: booking.passengers,
    train: service ? describeService(service) : booking.serviceId,
    coach: booking.coach,
    seat: booking.seat,
    class: booking.travelClass,
    fare: money(booking.fare),
    status: booking.status,
    refundedSoFar: money(booking.refunded),
    running: running(disruption),
    advice: disruption?.advice ?? null,
    notes: booking.notes,
  };
};

type Args = Record<string, unknown>;

const HANDLERS: {
  [K in BackOfficeToolName]: (args: Args, ctx: ToolContext) => Draft;
} = {
  get_disruptions(args, ctx) {
    const wanted =
      typeof args.serviceId === "string" && args.serviceId
        ? serviceOf(args.serviceId)
        : null;
    if (typeof args.serviceId === "string" && args.serviceId && !wanted)
      return fail(`There is no train ${args.serviceId} on today's timetable.`);
    const rows = ctx.records
      .filter(
        (record): record is BackOfficeRecord<"disruption"> =>
          record.kind === "disruption",
      )
      .filter(
        (record) =>
          !wanted || serviceOf(record.data.serviceId)?.id === wanted.id,
      )
      .map((record) => ({
        train: record.data.serviceId,
        running: running(record.data),
        advice: record.data.advice,
      }));
    if (wanted && rows.length === 0)
      return {
        ok: true,
        output: { train: describeService(wanted), running: "on time" },
        summary: `${wanted.id} is on time`,
      };
    return {
      ok: true,
      output: { disruptions: rows, everythingElse: "on time" },
      summary: `${rows.length} disruption${rows.length === 1 ? "" : "s"} today`,
    };
  },

  find_booking(args, ctx) {
    const reference = String(args.reference);
    const booking = bookingOf(ctx, reference);
    if (!booking)
      return fail(
        `No booking has the reference ${normalizeReference(reference)}. Ask the Caller to read it again.`,
      );
    const refused = identityRefusal(ctx, reference);
    if (refused) return refused;
    return {
      ok: true,
      output: bookingView(booking, disruptionOf(ctx, booking.serviceId)),
      summary: `Found ${booking.reference}`,
    };
  },

  verify_identity(args, ctx) {
    const reference = String(args.reference);
    const rule = ruleOf(ctx.rulebook, "identity.verify");
    const booking = bookingOf(ctx, reference);
    if (!booking)
      return fail(
        `No booking has the reference ${normalizeReference(reference)}. Ask the Caller to read it again.`,
      );
    const undisclosed = disclosureRefusal(ctx, "disclosure.recording");
    if (undisclosed) return undisclosed;
    if (ctx.state.locked)
      return identityRefusal(ctx, reference) ?? fail("The line is locked.");
    if (isVerified(ctx, reference))
      return {
        ok: true,
        output: { verified: true, passenger: booking.passenger.name },
        summary: `Identity already verified for ${booking.reference}`,
      };
    const factor = String(args.factor) as IdentityFactor;
    if (rule.enabled && !list(rule, "factors").includes(factor))
      return refuse(
        [hit(rule, `That second factor (${factor}) is not accepted.`)],
        `Ask the Caller for ${factorLabels(rule)} instead.`,
      );
    const said = String(args.value);
    const squash = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9@.]/g, "");
    const expected =
      factor === "postcode"
        ? booking.passenger.postcode
        : factor === "card_last4"
          ? booking.passenger.cardLast4
          : booking.passenger.email;
    const matches =
      factor === "email"
        ? squash(said) === squash(expected)
        : squash(said).replace(/[@.]/g, "") ===
          squash(expected).replace(/[@.]/g, "");
    if (matches) {
      return {
        ok: true,
        output: {
          verified: true,
          passenger: booking.passenger.name,
          next: "You may now use the booking tools for this reference.",
        },
        state: {
          verified: [...ctx.state.verified, normalizeReference(reference)],
        },
        summary: `Identity verified for ${booking.reference}`,
      };
    }
    const attempts = ctx.state.attempts + 1;
    const max = rule.enabled
      ? num(rule, "maxAttempts")
      : Number.POSITIVE_INFINITY;
    const locked = attempts >= max;
    const refused = refuse(
      [
        hit(
          rule,
          locked
            ? `That does not match, and it was attempt ${attempts} of ${max}: the line is now locked for this Call.`
            : `That does not match the booking (attempt ${attempts} of ${max}).`,
        ),
      ],
      locked
        ? "Tell the Caller you cannot verify them on this line and offer hand_off."
        : "Tell the Caller it did not match, without saying what the right answer is, and ask again.",
    );
    return { ...refused, state: { attempts, locked } };
  },

  rebooking_options(args, ctx) {
    const reference = String(args.reference);
    const booking = bookingOf(ctx, reference);
    if (!booking) return fail("No booking has that reference.");
    const refused = identityRefusal(ctx, reference);
    if (refused) return refused;
    const current = serviceOf(booking.serviceId);
    const options = SERVICES.filter(
      (service) =>
        service.line === current?.line &&
        service.id !== current.id &&
        service.departs > current.departs,
    ).map((service) => ({
      train: describeService(service),
      running: running(disruptionOf(ctx, service.id)),
    }));
    return {
      ok: true,
      output: {
        current: current ? describeService(current) : booking.serviceId,
        currentRunning: running(disruptionOf(ctx, booking.serviceId)),
        options,
        note: options.length
          ? "Moving to any of these is free."
          : "There is no later train on this line today; a change of day or line needs a person.",
      },
      summary: `${options.length} later train${options.length === 1 ? "" : "s"}`,
    };
  },

  rebook(args, ctx) {
    const reference = String(args.reference);
    const booking = bookingOf(ctx, reference);
    if (!booking) return fail("No booking has that reference.");
    const refused = identityRefusal(ctx, reference) ?? humanRefusal(ctx);
    if (refused) return refused;
    const current = serviceOf(booking.serviceId);
    const target = serviceOf(String(args.serviceId));
    if (!target)
      return fail(`There is no train ${String(args.serviceId)} today.`);
    if (target.id === current?.id)
      return fail(`The booking is already on ${target.id}.`);
    if (target.line !== current?.line)
      return fail(
        `${target.id} is on another line. A change of line is a new booking and needs a person: offer hand_off.`,
      );
    if (booking.status === "refunded")
      return fail("This booking was refunded in full and cannot be moved.");
    if (disruptionOf(ctx, target.id)?.kind === "cancellation")
      return fail(`${target.id} is cancelled today. Offer another train.`);
    if (current && target.departs <= current.departs)
      return fail(
        `${target.id} leaves before ${current.id}. A booking moves only to a later train: call rebooking_options.`,
      );
    const next: Booking = {
      ...booking,
      serviceId: target.id,
      status: "rebooked",
      notes: [
        ...booking.notes,
        `Moved from ${current?.id ?? booking.serviceId} to ${target.id} by phone.`,
      ].slice(-20),
    };
    return {
      ok: true,
      output: {
        rebooked: true,
        reference: booking.reference,
        train: describeService(target),
        running: running(disruptionOf(ctx, target.id)),
        seat: `coach ${booking.coach}, seat ${booking.seat} (same seat number)`,
        note: "A confirmation is sent after the Call.",
      },
      writes: [
        { op: "update", kind: "booking", ref: booking.reference, data: next },
      ],
      summary: `Moved ${booking.reference} to ${target.id}`,
    };
  },

  issue_refund(args, ctx) {
    const reference = String(args.reference);
    const booking = bookingOf(ctx, reference);
    if (!booking) return fail("No booking has that reference.");
    const refused =
      identityRefusal(ctx, reference) ??
      humanRefusal(ctx) ??
      disclosureRefusal(ctx, "disclosure.refund");
    if (refused) return refused;
    const amount = round2(Number(args.amount));
    const limits = ruleOf(ctx.rulebook, "refund.limits");
    const { due, basis } = refundDue(
      booking,
      disruptionOf(ctx, booking.serviceId),
      limits,
    );
    if (amount > due + 0.001)
      return refuse(
        [
          hit(
            limits,
            due > 0
              ? `At most ${money(due)} is due on this booking (${basis}); ${money(amount)} was asked for.`
              : `No refund is due on this booking: ${basis}.`,
          ),
        ],
        due > 0
          ? `Offer ${money(due)}. If the Caller wants more, offer hand_off to customer relations.`
          : "Explain why no refund is due. If the Caller disagrees, offer hand_off to customer relations.",
      );
    const human = ruleOf(ctx.rulebook, "human.required");
    // Counted over the whole Booking, so the limit cannot be passed in slices.
    const total = round2(booking.refunded + amount);
    if (human.enabled && total > num(human, "maxRefund") + 0.001)
      return refuse(
        [
          hit(
            human,
            booking.refunded > 0
              ? `${money(booking.refunded)} is already refunded on this booking; ${money(amount)} more would pass the ${money(num(human, "maxRefund"))} the Agent may issue without a person.`
              : `A refund of ${money(amount)} is above the ${money(num(human, "maxRefund"))} the Agent may issue without a person.`,
          ),
        ],
        "Tell the Caller a person must approve it and call hand_off to customer relations with the amount and the reason.",
      );
    const refSeq = ctx.refSeq + 1;
    const ref = formatRef(REF_PREFIX.compensation, refSeq);
    const refunded = round2(booking.refunded + amount);
    return {
      ok: true,
      output: {
        refunded: true,
        refundReference: ref,
        amount: money(amount),
        basis,
        note: "A confirmation is sent after the Call.",
      },
      writes: [
        {
          op: "create",
          kind: "compensation",
          ref,
          data: {
            kind: "refund",
            bookingRef: booking.reference,
            amount,
            reason: String(args.reason),
            status: "issued",
          },
        },
        {
          op: "update",
          kind: "booking",
          ref: booking.reference,
          data: {
            ...booking,
            refunded,
            status:
              refunded >= booking.fare - 0.001 ? "refunded" : booking.status,
            notes: [
              ...booking.notes,
              `Refund ${ref} of ${money(amount)} issued by phone.`,
            ].slice(-20),
          },
        },
      ],
      refSeq,
      summary: `Refunded ${money(amount)} on ${booking.reference} (${ref})`,
    };
  },

  issue_voucher(args, ctx) {
    const reference = String(args.reference);
    const booking = bookingOf(ctx, reference);
    if (!booking) return fail("No booking has that reference.");
    const refused = identityRefusal(ctx, reference) ?? humanRefusal(ctx);
    if (refused) return refused;
    const amount = round2(Number(args.amount));
    const rule = ruleOf(ctx.rulebook, "goodwill.limits");
    if (rule.enabled) {
      const disruption = disruptionOf(ctx, booking.serviceId);
      if (
        flag(rule, "requiresDisruption") &&
        (!disruption || disruption.kind === "platform_change")
      )
        return refuse(
          [
            hit(
              rule,
              "Goodwill is only for a delayed or cancelled train, and this one is running.",
            ),
          ],
          "Explain that no voucher is due. If the Caller disagrees, offer hand_off.",
        );
      const left = round2(num(rule, "maxPerCall") - ctx.state.vouchers);
      if (amount > left + 0.001)
        return refuse(
          [
            hit(
              rule,
              left > 0
                ? `At most ${money(left)} of goodwill is left in this Call (${money(num(rule, "maxPerCall"))} in all); ${money(amount)} was asked for.`
                : `The goodwill limit of ${money(num(rule, "maxPerCall"))} for one Call is used up.`,
            ),
          ],
          left > 0
            ? `Offer ${money(left)}, or hand_off if the Caller wants more.`
            : "Offer hand_off if the Caller wants more.",
        );
    }
    const refSeq = ctx.refSeq + 1;
    const ref = formatRef(REF_PREFIX.compensation, refSeq);
    return {
      ok: true,
      output: { issued: true, voucherReference: ref, amount: money(amount) },
      writes: [
        {
          op: "create",
          kind: "compensation",
          ref,
          data: {
            kind: "voucher",
            bookingRef: booking.reference,
            amount,
            reason: String(args.reason),
            status: "issued",
          },
        },
        {
          op: "update",
          kind: "booking",
          ref: booking.reference,
          data: { ...booking, vouchers: round2(booking.vouchers + amount) },
        },
      ],
      state: { vouchers: round2(ctx.state.vouchers + amount) },
      refSeq,
      summary: `Voucher of ${money(amount)} on ${booking.reference} (${ref})`,
    };
  },

  file_lost_property(args, ctx) {
    const refused = humanRefusal(ctx);
    if (refused) return refused;
    const service =
      typeof args.serviceId === "string" && args.serviceId
        ? serviceOf(args.serviceId)
        : undefined;
    const refSeq = ctx.refSeq + 1;
    const ref = formatRef(REF_PREFIX.lost_property, refSeq);
    return {
      ok: true,
      output: {
        filed: true,
        reportReference: ref,
        note: "Lost Property at Meridia Central will be in touch if it is found. Items are kept 30 days.",
      },
      writes: [
        {
          op: "create",
          kind: "lost_property",
          ref,
          data: {
            description: String(args.description),
            serviceId: service?.id ?? "",
            where: typeof args.where === "string" ? args.where : "",
            contact: String(args.contact),
            status: "reported",
          },
        },
      ],
      refSeq,
      summary: `Lost property report ${ref}`,
    };
  },

  book_assistance(args, ctx) {
    const reference = String(args.reference);
    const booking = bookingOf(ctx, reference);
    if (!booking) return fail("No booking has that reference.");
    const refused = identityRefusal(ctx, reference) ?? humanRefusal(ctx);
    if (refused) return refused;
    const service = serviceOf(booking.serviceId);
    const stops = service ? [service.from, ...service.via, service.to] : [];
    const wanted = String(args.station).toLowerCase();
    const station = stops.find(
      (stop) =>
        stop.toLowerCase() === wanted ||
        stop.toLowerCase().includes(wanted) ||
        wanted.includes(stop.toLowerCase()),
    );
    if (!station)
      return fail(
        `${String(args.station)} is not on this booking's route (${stops.join(", ")}).`,
      );
    const refSeq = ctx.refSeq + 1;
    const ref = formatRef(REF_PREFIX.assistance, refSeq);
    return {
      ok: true,
      output: {
        booked: true,
        assistanceReference: ref,
        station,
        kind: args.kind,
        note: "Staff meet the passenger at the assistance point 20 minutes before departure.",
      },
      writes: [
        {
          op: "create",
          kind: "assistance",
          ref,
          data: {
            bookingRef: booking.reference,
            station,
            kind: args.kind as RecordData["assistance"]["kind"],
            notes: typeof args.notes === "string" ? args.notes : "",
            status: "booked",
          },
        },
      ],
      refSeq,
      summary: `Assistance ${ref} at ${station}`,
    };
  },

  schedule_callback(args, ctx) {
    const refused = humanRefusal(ctx);
    if (refused) return refused;
    if (ctx.state.callbackRef)
      return fail(
        `A callback is already scheduled for this Call (${ctx.state.callbackRef}).`,
      );
    const asked = Number(args.inMinutes);
    const inMinutes = Math.min(asked, LIMITS.callbackMaxMinutes);
    const refSeq = ctx.refSeq + 1;
    const ref = formatRef(REF_PREFIX.callback, refSeq);
    return {
      ok: true,
      output: {
        scheduled: true,
        callbackReference: ref,
        inMinutes,
        note:
          inMinutes < asked
            ? `This line calls back within ${LIMITS.callbackMaxMinutes} minutes at most, so it is set to ${inMinutes}.`
            : "The line calls back after this Call ends.",
      },
      writes: [
        {
          op: "create",
          kind: "callback",
          ref,
          data: {
            bookingRef:
              typeof args.reference === "string"
                ? normalizeReference(args.reference)
                : "",
            reason: String(args.reason),
            inMinutes,
            dueAt: "",
            status: "scheduled",
          },
        },
      ],
      state: { callbackRef: ref },
      refSeq,
      summary: `Callback ${ref} in ${inMinutes} min`,
    };
  },

  hand_off(args, ctx) {
    const refSeq = ctx.refSeq + 1;
    const ref = formatRef(REF_PREFIX.handoff, refSeq);
    return {
      ok: true,
      output: {
        handedOff: true,
        handOffReference: ref,
        note: "A person will pick this up. Tell the Caller the reference and that they need not repeat themselves.",
      },
      writes: [
        {
          op: "create",
          kind: "handoff",
          ref,
          data: {
            reason: String(args.reason),
            summary: String(args.summary),
            queue: args.queue as RecordData["handoff"]["queue"],
            status: "waiting",
          },
        },
      ],
      state: { handedOff: true },
      refSeq,
      summary: `Handed off to ${String(args.queue).replace(/_/g, " ")} (${ref})`,
    };
  },

  read_policy(args, ctx) {
    const topic = String(args.topic) as PolicyTopic;
    const rule = ruleOf(ctx.rulebook, "topics.refused");
    const policy = POLICIES[topic];
    if (!policy) return fail("There is no policy on that topic.");
    if (rule.enabled && list(rule, "topics").includes(topic))
      return refuse(
        [hit(rule, `"${policy.title}" is not discussed on this line.`)],
        "Tell the Caller this is not something the line can discuss, and offer what you can help with instead.",
      );
    return {
      ok: true,
      output: { title: policy.title, policy: policy.body },
      summary: `Read "${policy.title}"`,
    };
  },
};

/**
 * Runs one tool call against the Back office. Never throws on bad input: a
 * tool that does not exist, arguments that do not fit, a Call past its
 * deadline or over its tool budget all come back as a result the Agent can
 * hear.
 */
export function runBackOfficeTool(
  name: string,
  args: unknown,
  ctx: ToolContext,
): ToolResult {
  const state: CallState = { ...ctx.state, toolCalls: ctx.state.toolCalls + 1 };
  const finish = (draft: Draft): ToolResult => ({
    ok: draft.ok,
    output: draft.output,
    refusal: draft.refusal ?? [],
    writes: draft.writes ?? [],
    state: { ...state, ...draft.state },
    refSeq: draft.refSeq ?? ctx.refSeq,
    summary: draft.summary,
  });
  if (!isBackOfficeTool(name))
    return finish(fail(`There is no tool called ${name}.`));
  if (ctx.overDeadline)
    return finish(
      refuse(
        [
          hit(
            ruleOf(ctx.rulebook, "call.length"),
            "The Call has reached its longest length.",
          ),
        ],
        "Say goodbye now; the line is about to be cut.",
      ),
    );
  if (ctx.state.toolCalls >= LIMITS.toolCallsPerCall)
    return finish(
      fail(
        `This Call has used its ${LIMITS.toolCallsPerCall} tool calls. Offer to end the Call.`,
      ),
    );
  const parsed = BACK_OFFICE_TOOLS[name].input.safeParse(args ?? {});
  if (!parsed.success)
    return finish(
      fail(
        `The arguments do not fit ${name}: ${parsed.error.issues[0]?.message ?? "check them"}.`,
      ),
    );
  return finish(withAuthority(ctx, HANDLERS[name](parsed.data as Args, ctx)));
}
