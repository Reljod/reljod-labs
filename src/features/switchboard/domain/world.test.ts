import { describe, expect, it } from "vitest";
import {
  disruptionForIssue,
  disruptionSchema,
  formatRef,
  money,
  normalizeReference,
  normalizeServiceId,
  RECORD_SCHEMAS,
  round2,
  SEED_BOOKINGS,
  SEED_DISRUPTIONS,
  SERVICES,
  seedRecords,
  serviceOf,
} from "./world";

describe("seedRecords", () => {
  const seed = seedRecords();

  it("holds every Booking and Disruption", () => {
    expect(seed.filter((record) => record.kind === "booking")).toHaveLength(
      SEED_BOOKINGS.length,
    );
    expect(seed.filter((record) => record.kind === "disruption")).toHaveLength(
      SEED_DISRUPTIONS.length,
    );
  });

  it("validates every Record against its schema", () => {
    for (const record of seed) {
      const parsed = RECORD_SCHEMAS[record.kind].safeParse(record.data);
      expect(parsed.success, `${record.kind} ${record.ref}`).toBe(true);
    }
  });

  it("gives every Record a unique reference", () => {
    const refs = seed.map((record) => record.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("uses a Booking's own reference, already in normal form", () => {
    for (const booking of SEED_BOOKINGS) {
      expect(normalizeReference(booking.reference)).toBe(booking.reference);
      expect(booking.reference).toMatch(/^MR-[0-9A-Z]{6}$/);
    }
  });

  it("puts every Booking and Disruption on a Service of the timetable", () => {
    for (const booking of SEED_BOOKINGS)
      expect(serviceOf(booking.serviceId)).toBeDefined();
    for (const { data } of SEED_DISRUPTIONS)
      expect(serviceOf(data.serviceId)).toBeDefined();
  });

  it("prices a Booking from its Service, its passengers and its class", () => {
    for (const booking of SEED_BOOKINGS) {
      const fare = serviceOf(booking.serviceId)?.fare ?? 0;
      const factor = booking.travelClass === "first" ? 1.6 : 1;
      expect(booking.fare).toBe(round2(fare * booking.passengers * factor));
    }
    expect(
      SEED_BOOKINGS.find((booking) => booking.reference === "MR-5N1X8C")?.fare,
    ).toBe(550.4);
  });

  it("returns a fresh list each time", () => {
    expect(seedRecords()).not.toBe(seedRecords());
  });
});

describe("normalizeReference", () => {
  it("reads a reference however it was said or typed", () => {
    for (const said of [
      "MR-7K2Q9F",
      "mr-7k2q9f",
      "MR7K2Q9F",
      "mr 7k2q9f",
      "m r 7 k 2 q 9 f",
      " M.R. 7K2-Q9F ",
    ])
      expect(normalizeReference(said), said).toBe("MR-7K2Q9F");
  });

  it("leaves other references compact and uppercase", () => {
    expect(normalizeReference("rf-0001")).toBe("RF0001");
    expect(normalizeReference("mr")).toBe("MR");
    expect(normalizeReference("")).toBe("");
  });
});

describe("normalizeServiceId and serviceOf", () => {
  it("reads a train number however it was written", () => {
    for (const said of ["IC 418", "IC418", "ic-418", " i c 4 1 8 "]) {
      expect(normalizeServiceId(said)).toBe("IC418");
      expect(serviceOf(said)?.id).toBe("IC 418");
    }
  });

  it("finds no train that is not on the timetable", () => {
    expect(serviceOf("IC 999")).toBeUndefined();
    expect(serviceOf("")).toBeUndefined();
  });

  it("has unique train numbers", () => {
    const ids = SERVICES.map((service) => normalizeServiceId(service.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("disruptionForIssue", () => {
  it("delays a train and names the next two on its line", () => {
    const made = disruptionForIssue("delay", "IC 418");
    expect(made?.ref).toBe("D-IC418");
    expect(made?.data).toMatchObject({
      serviceId: "IC 418",
      kind: "delay",
      minutes: 75,
    });
    expect(made?.data.advice).toBe(
      "IC 422 at 15:05 and IC 426 at 16:05 run on time on the same route.",
    );
    expect(disruptionSchema.safeParse(made?.data).success).toBe(true);
  });

  it("cancels a train", () => {
    const made = disruptionForIssue("cancellation", "RE 77");
    expect(made?.data).toMatchObject({ kind: "cancellation", minutes: 0 });
    expect(made?.data.advice).toBe(
      "RE 81 at 11:12 run on time on the same route.",
    );
    expect(disruptionSchema.safeParse(made?.data).success).toBe(true);
  });

  it("says when it is the last train of the day", () => {
    expect(disruptionForIssue("delay", "IC 426")?.data.advice).toBe(
      "This is the last train on the route today.",
    );
  });

  it("puts nothing on a train for issues that are not about it", () => {
    expect(disruptionForIssue("lost_property", "IC 418")).toBeNull();
    expect(disruptionForIssue("assistance", "IC 418")).toBeNull();
    expect(disruptionForIssue("none", "IC 418")).toBeNull();
  });
});

describe("formatRef, money, round2", () => {
  it("pads a reference number to four digits", () => {
    expect(formatRef("RF", 7)).toBe("RF-0007");
    expect(formatRef("HO", 12345)).toBe("HO-12345");
  });

  it("shows money with two decimals and the currency", () => {
    expect(money(43)).toBe("43.00 MRD");
    expect(money(1234.5)).toBe("1,234.50 MRD");
  });

  it("rounds away float dust", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(86 * 4 * 1.6)).toBe(550.4);
  });
});
