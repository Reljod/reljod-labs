/**
 * The Meridia Rail world: a timetable that is the same for everyone, and the
 * Records each Workspace starts with. Everything is fictional (Republic of
 * Meridia); every name, reference and card ending is made up.
 */
import { z } from "zod";

export const CURRENCY = "MRD";

export const money = (amount: number) =>
  `${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY}`;

/** Two decimals, no float dust. */
export const round2 = (amount: number) => Math.round(amount * 100) / 100;

export type Station = { code: string; name: string };

export const STATIONS: Station[] = [
  { code: "MCE", name: "Meridia Central" },
  { code: "ARJ", name: "Arden Junction" },
  { code: "PCA", name: "Port Calder" },
  { code: "VES", name: "Vessin" },
  { code: "LIH", name: "Lisle Harbour" },
  { code: "LUH", name: "Lumen Harbour" },
  { code: "PSE", name: "Port Selene" },
  { code: "TAL", name: "Talmere" },
];

export type Service = {
  id: string;
  line: string;
  from: string;
  to: string;
  via: string[];
  departs: string;
  arrives: string;
  fare: number;
};

export const SERVICES: Service[] = [
  svc("IC 418", "Coast Line", "14:05", "16:40", 86),
  svc("IC 422", "Coast Line", "15:05", "17:40", 86),
  svc("IC 426", "Coast Line", "16:05", "18:40", 86),
  svc("RE 73", "Harbour Line", "09:12", "10:02", 24.5),
  svc("RE 77", "Harbour Line", "10:12", "11:02", 24.5),
  svc("RE 81", "Harbour Line", "11:12", "12:02", 24.5),
  svc("IC 305", "Northern Line", "08:20", "11:05", 64),
  svc("IC 309", "Northern Line", "10:20", "13:05", 64),
  svc("IC 313", "Northern Line", "12:20", "15:05", 64),
  svc("NX 9", "Night Express", "22:30", "05:55", 129),
];

function svc(
  id: string,
  line: string,
  departs: string,
  arrives: string,
  fare: number,
): Service {
  const route: Record<string, [string, string, string[]]> = {
    "Coast Line": [
      "Meridia Central",
      "Vessin",
      ["Arden Junction", "Port Calder"],
    ],
    "Harbour Line": ["Meridia Central", "Lumen Harbour", ["Lisle Harbour"]],
    "Northern Line": ["Meridia Central", "Talmere", ["Arden Junction"]],
    "Night Express": ["Port Selene", "Meridia Central", ["Port Calder"]],
  };
  const [from, to, via] = route[line];
  return { id, line, from, to, via, departs, arrives, fare };
}

export function serviceOf(id: string): Service | undefined {
  const wanted = normalizeServiceId(id);
  return SERVICES.find((service) => normalizeServiceId(service.id) === wanted);
}

/** "ic418", "IC-418" and "IC 418" are one train. */
export function normalizeServiceId(id: string) {
  return id.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "mr 7k2q9f", "MR7K2Q9F" and "MR-7K2Q9F" are one Booking. */
export function normalizeReference(reference: string) {
  const compact = reference.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.startsWith("MR") && compact.length > 2
    ? `MR-${compact.slice(2)}`
    : compact;
}

// Records -------------------------------------------------------------------------------

export const RECORD_KINDS = [
  "booking",
  "disruption",
  "compensation",
  "lost_property",
  "assistance",
  "handoff",
  "callback",
  "confirmation",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_LABEL: Record<RecordKind, string> = {
  booking: "Bookings",
  disruption: "Disruptions",
  compensation: "Refunds & vouchers",
  lost_property: "Lost property",
  assistance: "Assistance",
  handoff: "Hand-offs",
  callback: "Callbacks",
  confirmation: "Confirmations sent",
};

const text = (max: number) => z.string().trim().min(1).max(max);

export const bookingSchema = z.object({
  reference: text(20),
  passenger: z.object({
    name: text(80),
    surname: text(60),
    postcode: text(12),
    email: text(120),
    cardLast4: z.string().regex(/^\d{4}$/),
  }),
  serviceId: text(12),
  coach: text(4),
  seat: text(6),
  travelClass: z.enum(["standard", "first"]),
  passengers: z.number().int().min(1).max(20),
  fare: z.number().min(0).max(10_000),
  status: z.enum(["confirmed", "rebooked", "refunded"]),
  /** Total refunded so far, and total vouchers issued against it. */
  refunded: z.number().min(0),
  vouchers: z.number().min(0),
  notes: z.array(text(200)).max(20),
});
export type Booking = z.infer<typeof bookingSchema>;

export const disruptionSchema = z.object({
  serviceId: text(12),
  kind: z.enum(["delay", "cancellation", "platform_change"]),
  /** Minutes late, for a delay. */
  minutes: z.number().int().min(0).max(600),
  reason: text(200),
  advice: text(300),
});
export type Disruption = z.infer<typeof disruptionSchema>;

export const compensationSchema = z.object({
  kind: z.enum(["refund", "voucher"]),
  bookingRef: text(20),
  amount: z.number().min(0).max(10_000),
  reason: text(300),
  status: z.literal("issued"),
});
export type Compensation = z.infer<typeof compensationSchema>;

export const lostPropertySchema = z.object({
  description: text(300),
  serviceId: z.string().max(12),
  where: z.string().max(120),
  contact: text(160),
  status: z.literal("reported"),
});
export type LostProperty = z.infer<typeof lostPropertySchema>;

export const ASSISTANCE_KINDS = [
  "ramp",
  "wheelchair",
  "guide",
  "luggage",
] as const;

export const assistanceSchema = z.object({
  bookingRef: text(20),
  station: text(60),
  kind: z.enum(ASSISTANCE_KINDS),
  notes: z.string().max(300),
  status: z.literal("booked"),
});
export type Assistance = z.infer<typeof assistanceSchema>;

export const handoffSchema = z.object({
  reason: text(200),
  summary: text(600),
  queue: z.enum(["customer_relations", "safety", "accessibility", "duty_manager"]),
  status: z.literal("waiting"),
});
export type Handoff = z.infer<typeof handoffSchema>;

export const callbackSchema = z.object({
  bookingRef: z.string().max(20),
  reason: text(300),
  /** Minutes after the Call ends. */
  inMinutes: z.number().int().min(1).max(600),
  dueAt: z.string().max(40),
  status: z.enum(["scheduled", "due", "done"]),
});
export type Callback = z.infer<typeof callbackSchema>;

export const confirmationSchema = z.object({
  to: text(160),
  subject: text(160),
  body: text(2000),
});
export type Confirmation = z.infer<typeof confirmationSchema>;

export const RECORD_SCHEMAS = {
  booking: bookingSchema,
  disruption: disruptionSchema,
  compensation: compensationSchema,
  lost_property: lostPropertySchema,
  assistance: assistanceSchema,
  handoff: handoffSchema,
  callback: callbackSchema,
  confirmation: confirmationSchema,
} as const;

export type RecordData = {
  booking: Booking;
  disruption: Disruption;
  compensation: Compensation;
  lost_property: LostProperty;
  assistance: Assistance;
  handoff: Handoff;
  callback: Callback;
  confirmation: Confirmation;
};

/** A Record as the Back office shows it. */
export type BackOfficeRecord<K extends RecordKind = RecordKind> = {
  id: string;
  kind: K;
  ref: string;
  data: RecordData[K];
  /** The Call that made or last changed it. */
  callId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The prefix of a reference the Back office hands out. */
export const REF_PREFIX: Record<
  Exclude<RecordKind, "booking" | "disruption">,
  string
> = {
  compensation: "RF",
  lost_property: "LP",
  assistance: "AS",
  handoff: "HO",
  callback: "CB",
  confirmation: "CF",
};

export const formatRef = (prefix: string, seq: number) =>
  `${prefix}-${String(seq).padStart(4, "0")}`;

// Seed ----------------------------------------------------------------------------------

export const SEED_VERSION = 1;

function booking(
  reference: string,
  name: string,
  postcode: string,
  cardLast4: string,
  serviceId: string,
  seat: string,
  extra: Partial<Booking> = {},
): Booking {
  const surname = name.split(" ").slice(-1)[0];
  const service = serviceOf(serviceId);
  const passengers = extra.passengers ?? 1;
  const first = extra.travelClass === "first";
  return {
    reference,
    passenger: {
      name,
      surname,
      postcode,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@post.meridia.example`,
      cardLast4,
    },
    serviceId,
    coach: seat.slice(0, 1),
    seat: seat.slice(1),
    travelClass: "standard",
    passengers,
    fare: round2((service?.fare ?? 0) * passengers * (first ? 1.6 : 1)),
    status: "confirmed",
    refunded: 0,
    vouchers: 0,
    notes: [],
    ...extra,
  };
}

export const SEED_BOOKINGS: Booking[] = [
  booking("MR-7K2Q9F", "Lena Abad", "4107", "4821", "IC 418", "C12A"),
  booking("MR-3H8D2W", "Tomas Reyes", "2210", "1093", "RE 73", "B04D"),
  booking("MR-9B4T6M", "Liza Dimaculangan", "5530", "7716", "IC 305", "D21C", {
    passengers: 2,
    notes: ["Travelling with her grandmother."],
  }),
  booking("MR-5N1X8C", "Oskar Halvorsen", "1004", "3350", "IC 418", "A02B", {
    passengers: 4,
    travelClass: "first",
  }),
  booking("MR-2V6J3R", "Carmen Soto", "3301", "9042", "IC 309", "E08A", {
    notes: ["Wheelchair user."],
  }),
  booking("MR-8P0L4Y", "Jun Park", "6120", "2687", "NX 9", "S03L"),
  booking("MR-6F2G7Z", "Amara Okafor", "4410", "5179", "IC 422", "C17D"),
  booking("MR-1Q5S9K", "Piet Dalen", "2984", "6403", "RE 77", "B11A"),
];

export const SEED_DISRUPTIONS: { ref: string; data: Disruption }[] = [
  {
    ref: "D-IC418",
    data: {
      serviceId: "IC 418",
      kind: "delay",
      minutes: 75,
      reason: "Signalling fault at Arden Junction",
      advice:
        "IC 422 at 15:05 and IC 426 at 16:05 run on time on the same route.",
    },
  },
  {
    ref: "D-RE73",
    data: {
      serviceId: "RE 73",
      kind: "cancellation",
      minutes: 0,
      reason: "Train crew shortage",
      advice: "RE 77 at 10:12 and RE 81 at 11:12 run on time.",
    },
  },
  {
    ref: "D-IC305",
    data: {
      serviceId: "IC 305",
      kind: "platform_change",
      minutes: 0,
      reason: "Departs platform 9 instead of platform 4",
      advice: "Allow five extra minutes to reach platform 9.",
    },
  },
];

/** What a Workspace's Back office holds on first use, and after a reset. */
export function seedRecords(): { kind: RecordKind; ref: string; data: unknown }[] {
  return [
    ...SEED_BOOKINGS.map((data) => ({
      kind: "booking" as const,
      ref: data.reference,
      data,
    })),
    ...SEED_DISRUPTIONS.map(({ ref, data }) => ({
      kind: "disruption" as const,
      ref,
      data,
    })),
  ];
}

/** What went wrong, for a visitor's own Scenario. */
export const ISSUES = [
  {
    id: "delay",
    label: "My train is badly delayed",
    hint: "Ask about the delay, a later train or money back.",
  },
  {
    id: "cancellation",
    label: "My train was cancelled",
    hint: "Ask for a refund or another train.",
  },
  {
    id: "lost_property",
    label: "I left something on the train",
    hint: "Describe it and where you sat.",
  },
  {
    id: "assistance",
    label: "I need help at the station",
    hint: "Ask for a ramp, a wheelchair or a guide.",
  },
  {
    id: "none",
    label: "Nothing is wrong: just call",
    hint: "Ask anything about your journey.",
  },
] as const;
export type IssueId = (typeof ISSUES)[number]["id"];

/** The Disruption a visitor's own Scenario puts on their Booking's Service. */
export function disruptionForIssue(
  issue: IssueId,
  serviceId: string,
): { ref: string; data: Disruption } | null {
  const ref = `D-${normalizeServiceId(serviceId)}`;
  const later = SERVICES.filter(
    (service) =>
      service.line === serviceOf(serviceId)?.line &&
      service.departs > (serviceOf(serviceId)?.departs ?? ""),
  )
    .slice(0, 2)
    .map((service) => `${service.id} at ${service.departs}`);
  const advice = later.length
    ? `${later.join(" and ")} run on time on the same route.`
    : "This is the last train on the route today.";
  if (issue === "delay")
    return {
      ref,
      data: {
        serviceId,
        kind: "delay",
        minutes: 75,
        reason: "Signalling fault at Arden Junction",
        advice,
      },
    };
  if (issue === "cancellation")
    return {
      ref,
      data: {
        serviceId,
        kind: "cancellation",
        minutes: 0,
        reason: "Train crew shortage",
        advice,
      },
    };
  return null;
}
