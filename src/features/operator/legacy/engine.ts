import { MESSAGE_TABLE, type MessageCode } from "./manual";
import type {
  CellStyle,
  Fixture,
  LegacyInput,
  LegacyKey,
  LegacyState,
  RecordKind,
  ScreenCode,
} from "./types";

/**
 * The one form engine every Screen is built from: fields, the message line,
 * the legend, locks and the confirm box. `machine.ts` drives it; the Screens
 * are in `screens.ts`.
 */

export type Message = { code: string; text: string; error: boolean };

export type ModalAction = "delete" | "place" | "release";

/** The confirm box: a question and a one-character answer. */
export type Modal = { action: ModalAction; text: string; answer: string };

export type MachineState = LegacyState & {
  /** Epoch ms at boot: the port clock is `portTime` plus the time since. */
  bootAt: number;
  portTime: string;
  operator: Fixture["operator"];
  idleSeconds: number;
  /** The fixture's locks, `retries` counting down as attempts fail. */
  locks: Fixture["locks"];
  message: Message | null;
  /** What is keyed into the Screen's fields, by field id. */
  values: Record<string, string>;
  /** The focused field's id; null means the Screen's first field. */
  focus: string | null;
  /** HMV200 and HMB500: validated, waiting for F10. Fields are protected. */
  pending: boolean;
  modal: Modal | null;
  help: boolean;
  /** List Screens: 0-based page. */
  page: number;
  /** HMC310 and HMC320: the voyage in view. */
  voyage: string;
  /** HMC320: the line being amended, 0 when adding. */
  editLine: number;
  /** HMC310: what the line-number prompt means. */
  prompt: "sel" | "del";
  /** HMH400: the container last looked up. */
  shown: string;
};

export type Field = {
  id: string;
  /** The cryptic label, such as `GR WT KG`. */
  label: string;
  row: number;
  col: number;
  width: number;
  masked?: boolean;
  /** Drawn as `LABEL ===> __` instead of a dotted leader. */
  arrow?: boolean;
};

export type LegendItem = { key: LegacyKey; label: string };

/** Cells that act like inputs when clicked (a menu option). */
export type Hotspot = {
  row: number;
  col: number;
  width: number;
  inputs: LegacyInput[];
};

export type Painter = (
  row: number,
  col: number,
  text: string,
  style?: CellStyle,
) => void;

export type ScreenSpec = {
  fields(s: MachineState): Field[];
  legend(s: MachineState): LegendItem[];
  paint(s: MachineState, put: Painter): void;
  hotspots?(s: MachineState): Hotspot[];
  /** The state after a key, or null when the key means nothing here. */
  key(s: MachineState, key: LegacyKey): MachineState | null;
  /** The confirm box was answered Y. */
  confirm?(s: MachineState, action: ModalAction): MachineState;
};

export const LABEL_COL = 4;
export const LIST_ROWS = 8;

// Messages -----------------------------------------------------------------------------------

/** Puts a message on the message line; an error message counts in `errors`. */
export function say(
  s: MachineState,
  code: MessageCode,
  arg = "",
): MachineState {
  const entry = MESSAGE_TABLE[code];
  const text = `${code} ${entry.text.replace("{}", arg)}`;
  return {
    ...s,
    message: { code, text, error: entry.error },
    errors: s.errors + (entry.error ? 1 : 0),
  };
}

// Navigation and fields ------------------------------------------------------------------------

/** Opens a Screen with an empty form. Whatever was half keyed is gone. */
export function open(
  s: MachineState,
  screen: ScreenCode,
  patch: Partial<MachineState> = {},
): MachineState {
  return {
    ...s,
    screen,
    values: {},
    focus: null,
    pending: false,
    modal: null,
    help: false,
    page: 0,
    prompt: "sel",
    message: null,
    ...patch,
  };
}

/** A field's value without the spaces around it. */
export function val(s: MachineState, id: string): string {
  return (s.values[id] ?? "").trim();
}

export function focusOn(s: MachineState, id: string): MachineState {
  return { ...s, focus: id };
}

/** An error message naming a field, with the cursor put on that field. */
export function reject(
  s: MachineState,
  code: MessageCode,
  field: Field,
): MachineState {
  return focusOn(say(s, code, field.label), field.id);
}

export function focusedField(s: MachineState, fields: Field[]): Field | null {
  return fields.find((f) => f.id === s.focus) ?? fields[0] ?? null;
}

// Locks ----------------------------------------------------------------------------------------

/**
 * A commit on a record another clerk holds fails while the lock has retries
 * left. Returns the refused state, or null when the commit may go ahead.
 */
export function refusedByLock(
  s: MachineState,
  record: RecordKind,
  key: string,
): MachineState | null {
  const index = s.locks.findIndex(
    (l) => l.record === record && l.key === key && l.retries > 0,
  );
  if (index < 0) return null;
  const lock = s.locks[index];
  const locks = s.locks.map((l, i) =>
    i === index ? { ...l, retries: l.retries - 1 } : l,
  );
  return say({ ...s, locks }, "HM0417", lock.clerk);
}

// Paging ---------------------------------------------------------------------------------------

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / LIST_ROWS));
}

export function turnPage(
  s: MachineState,
  total: number,
  by: 1 | -1,
): MachineState {
  const page = s.page + by;
  if (page < 0) return say(s, "HM0007");
  if (page >= pageCount(total)) return say(s, "HM0008");
  return { ...s, page, message: null };
}

// Dates ----------------------------------------------------------------------------------------

const two = (n: number) => String(n).padStart(2, "0");

/** `DDMMYY` as `YYYY-MM-DD` (the century is 20), or null when it is no date. */
export function parseDate(ddmmyy: string): string | null {
  if (!/^\d{6}$/.test(ddmmyy)) return null;
  const day = Number(ddmmyy.slice(0, 2));
  const month = Number(ddmmyy.slice(2, 4));
  const year = 2000 + Number(ddmmyy.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${two(month)}-${two(day)}`;
}

/** `HHMM` as `HH:MM`, or null. */
export function parseTime(hhmm: string): string | null {
  if (!/^\d{4}$/.test(hhmm)) return null;
  const hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(2, 4));
  if (hour > 23 || minute > 59) return null;
  return `${two(hour)}:${two(minute)}`;
}

/** `2026-12-04T06:30` as the Screens show it: `04.12.26 06:30`. */
export function showStamp(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)} ${iso.slice(11, 16)}`;
}

/** The port's clock: the fixture's start time plus the time since boot. */
export function portClock(s: MachineState, now: number): string {
  const [date, time] = s.portTime.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const start = Date.UTC(y, m - 1, d, h, min);
  const elapsed = Math.max(0, now - s.bootAt);
  return showStamp(new Date(start + elapsed).toISOString().slice(0, 16));
}

// Legend and confirm box geometry (render and click share it) ----------------------------------

export const LEGEND_ROW = 23;
export const MESSAGE_ROW = 22;

export function legendText(item: LegendItem): string {
  return `${item.key.toUpperCase()}=${item.label}`;
}

export function legendLayout(
  items: LegendItem[],
): { item: LegendItem; col: number; width: number }[] {
  let col = 1;
  return items.map((item) => {
    const width = legendText(item).length;
    const placed = { item, col, width };
    col += width + 2;
    return placed;
  });
}

export const MODAL = {
  top: 8,
  left: 20,
  width: 40,
  height: 7,
  textRow: 10,
  answerRow: 11,
  answerLabel: "ANSWER ===> ",
  buttonRow: 13,
  yesCol: 28,
  noCol: 44,
  yes: "[ Y ]",
  no: "[ N ]",
} as const;

export const modalAnswerCol = MODAL.left + 3 + MODAL.answerLabel.length;
