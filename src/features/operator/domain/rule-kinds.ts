import type { Change, RecordKind } from "../legacy/types";

/**
 * The names the Rules use for changes to the Books and for fields. Kept
 * apart from rules.ts (which holds the zod schema) so the Guard, which is
 * bundled into the Screen sandbox, pulls in no schema library.
 */

/** What a change to the Books is called in the Rules. */
export const ACTION_KINDS = [
  "vessel.register",
  "vessel.amend",
  "line.add",
  "line.amend",
  "line.delete",
  "hold.place",
  "hold.release",
  "berth.allocate",
  "berth.amend",
  "berth.cancel",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_TITLES: Record<ActionKind, string> = {
  "vessel.register": "Register a vessel arrival",
  "vessel.amend": "Amend a vessel",
  "line.add": "Add a manifest line",
  "line.amend": "Amend a manifest line",
  "line.delete": "Delete a manifest line",
  "hold.place": "Place a customs hold",
  "hold.release": "Release a customs hold",
  "berth.allocate": "Allocate a berth",
  "berth.amend": "Change a berth booking",
  "berth.cancel": "Cancel a berth booking",
};

/** What a Change is, in the Rules' words. */
export function actionKindOf(change: Change): ActionKind {
  const { record, op } = change;
  if (record === "vessel")
    return op === "add" ? "vessel.register" : "vessel.amend";
  if (record === "line")
    return op === "add"
      ? "line.add"
      : op === "delete"
        ? "line.delete"
        : "line.amend";
  if (record === "hold") {
    if (op === "add") return "hold.place";
    // Taking a hold off the file, or marking it RELEASED, both let the box go.
    if (op === "delete") return "hold.release";
    return change.after?.status === "RELEASED" ? "hold.release" : "hold.place";
  }
  return op === "add"
    ? "berth.allocate"
    : op === "delete"
      ? "berth.cancel"
      : "berth.amend";
}

/** Fields of an existing record a Rule can protect: `<record>.<field>`. */
export const FIELD_CODES = [
  "vessel.imo",
  "vessel.name",
  "vessel.flag",
  "vessel.voyage",
  "vessel.eta",
  "line.container",
  "line.consignee",
  "line.goods",
  "line.grossKg",
  "line.haz",
  "hold.reason",
  "berth.berth",
] as const;
export type FieldCode = (typeof FIELD_CODES)[number];

export const FIELD_TITLES: Record<FieldCode, string> = {
  "vessel.imo": "Vessel: IMO number",
  "vessel.name": "Vessel: name",
  "vessel.flag": "Vessel: flag",
  "vessel.voyage": "Vessel: voyage number",
  "vessel.eta": "Vessel: ETA",
  "line.container": "Manifest line: container number",
  "line.consignee": "Manifest line: consignee code",
  "line.goods": "Manifest line: goods description",
  "line.grossKg": "Manifest line: gross weight",
  "line.haz": "Manifest line: hazard class",
  "hold.reason": "Hold: reason code",
  "berth.berth": "Berth booking: berth",
};

export const fieldCodeOf = (record: RecordKind, field: string) =>
  `${record}.${field}`;
