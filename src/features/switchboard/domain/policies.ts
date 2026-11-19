/**
 * What `read_policy` returns: Meridia Rail's own words on a topic, loaded on
 * demand so the Agent's instructions stay short. Fictional, like the railway.
 */
import type { PolicyTopic } from "./rules";

export const POLICIES: Record<PolicyTopic, { title: string; body: string }> = {
  refunds: {
    title: "Refunds and delay compensation",
    body: "A cancelled train is refunded in full, or the passenger may take any later train on the same line at no charge. A long delay earns part of the fare back; the exact share and the delay that counts are set in the Rulebook and worked out by the Back office, never by the agent. Refunds go to the original payment method. Tickets bought with a voucher are refunded as a voucher. Refunds above the agent's limit go to Customer Relations.",
  },
  rebooking: {
    title: "Changing trains",
    body: "A passenger on a delayed or cancelled train may move to a later train on the same line the same day at no charge, seat permitting. A change to another line or another day is a new booking and is done by a person. First class passengers keep first class where the later train has it.",
  },
  lost_property: {
    title: "Lost property",
    body: "Items found on trains are taken to the Lost Property office at Meridia Central, platform 1, open 07:00 to 19:00. A report needs a description, the train and roughly where the passenger sat, and a way to reach them. Items are kept for 30 days. Passports and bank cards are handed to the station police after 24 hours.",
  },
  assistance: {
    title: "Assistance at stations",
    body: "Ramps, wheelchairs, a sighted guide or help with luggage can be booked for any station on the passenger's route, free of charge. Staff meet the passenger at the station's assistance point 20 minutes before departure. Assistance can be booked up to 30 minutes before the train.",
  },
  luggage: {
    title: "Luggage and bicycles",
    body: "Each passenger may bring two large items and one small one. Bicycles travel free on Regional trains outside 07:00 to 09:00 and need a 5 MRD reservation on InterCity trains. The Night Express carries bicycles only in the luggage van.",
  },
  staff_directory: {
    title: "Staff names and rosters",
    body: "Internal. Names, shifts and contact details of train crew and station staff are never given out on the public line.",
  },
  security_procedures: {
    title: "Security procedures and CCTV",
    body: "Internal. Camera coverage, patrol times and incident procedures are never discussed on the public line.",
  },
};
