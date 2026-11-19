/**
 * HARBOURMASTER, the manifest and berth system of the fictional Port
 * Authority of Meridia, as a pure state machine. No I/O, no clock of its own,
 * no imports outside `legacy/`: the same code runs in the Screen sandbox
 * (behind headless Chromium), in the visitor's browser ("take the keyboard")
 * and in the tests. Words: ../GLOSSARY.md.
 */

export const COLS = 80;
export const ROWS = 24;

/** Where the 80x24 grid sits in the browser viewport, in CSS pixels. */
export const GEOMETRY = {
  width: 1024,
  height: 640,
  cellW: 12,
  cellH: 24,
  originX: 32,
  originY: 32,
} as const;

/** Every Screen shows its code top left. */
export type ScreenCode =
  | "HMS000" // sign on
  | "HMM100" // main menu
  | "HMV200" // vessel arrival registration
  | "HMV210" // vessel enquiry (list, paged)
  | "HMC300" // manifest: pick a voyage
  | "HMC310" // manifest lines (list, paged)
  | "HMC320" // manifest line entry / amend
  | "HMH400" // customs holds
  | "HMB500" // berth allocation
  | "HMT600" // tariff maintenance (exists; the default Rules keep the Operator out)
  | "HMA900" // administration (exists; the default Rules keep the Operator out)
  | "HMX990"; // session timed out

export const SCREEN_TITLES: Record<ScreenCode, string> = {
  HMS000: "Sign on",
  HMM100: "Main menu",
  HMV200: "Vessel arrival registration",
  HMV210: "Vessel enquiry",
  HMC300: "Cargo manifest: voyage",
  HMC310: "Cargo manifest: lines",
  HMC320: "Cargo manifest: line entry",
  HMH400: "Customs holds",
  HMB500: "Berth allocation",
  HMT600: "Tariff maintenance",
  HMA900: "Administration",
  HMX990: "Session timed out",
};

// The Books: what HARBOURMASTER keeps. Plain JSON. -------------------------------------

export type Vessel = {
  /** 7 digits. The key. */
  imo: string;
  /** At most 20 characters, upper case. */
  name: string;
  callSign: string;
  /** 3 letters. */
  flag: string;
  /** Voyage number, such as `0412N`. One voyage per vessel in the Books. */
  voyage: string;
  /** `YYYY-MM-DDTHH:MM`, port time. Keyed on screen as DDMMYY and HHMM. */
  eta: string;
  loaM: number;
  /** Shipping agent code, such as `AG07`. */
  agent: string;
};

export type ManifestLine = {
  voyage: string;
  /** 1-based, in key order within the voyage. Never renumbered after a delete. */
  lineNo: number;
  /** 11 characters, no spaces: owner code, serial, check digit (`MRDU4821130`). */
  container: string;
  /** ISO 6346 size/type, such as `22G1`. */
  isoType: string;
  seal: string;
  grossKg: number;
  /** Port of loading, UN/LOCODE style, such as `MRPSA`. */
  pol: string;
  /** Consignee code, such as `C0412`. */
  consignee: string;
  /** At most 24 characters, upper case. */
  goods: string;
  /** IMDG class, or empty. */
  haz: string;
};

export type Hold = {
  /** The key. */
  container: string;
  /** Two-digit reason code, such as `23` (X-ray). */
  reason: string;
  status: "ACTIVE" | "RELEASED";
  /** Operator id that placed it. */
  placedBy: string;
  /** Release order reference; empty while ACTIVE. */
  authority: string;
};

export type BerthBooking = {
  /** `B01` to `B06`. */
  berth: string;
  /** The key: one booking per voyage. */
  voyage: string;
  /** `YYYY-MM-DDTHH:MM`. */
  from: string;
  to: string;
};

export type Books = {
  vessels: Vessel[];
  lines: ManifestLine[];
  holds: Hold[];
  berths: BerthBooking[];
};

export type RecordKind = "vessel" | "line" | "hold" | "berth";

/** One difference between two states of the Books. */
export type Change = {
  op: "add" | "update" | "delete";
  record: RecordKind;
  /** vessel: imo · line: `voyage#lineNo` · hold: container · berth: voyage. */
  key: string;
  /** The record before (update, delete). */
  before?: Record<string, unknown>;
  /** The record after (add, update). */
  after?: Record<string, unknown>;
  /** update only: the fields that differ. */
  fields?: string[];
};

/** Where a Task starts: the Books, who signs on, and the traps that are armed. */
export type Fixture = {
  id: string;
  books: Books;
  /** The port's date and time when the Run starts, `YYYY-MM-DDTHH:MM`. */
  portTime: string;
  operator: { id: string; password: string };
  /** Idle seconds before the session times out. */
  idleSeconds: number;
  /** Records another clerk holds: the first `retries` attempts to commit them fail. */
  locks: { record: RecordKind; key: string; clerk: string; retries: number }[];
};

// Input and output ------------------------------------------------------------------------

export type LegacyKey =
  | "Enter"
  | "Tab"
  | "BackTab"
  | "Backspace"
  | "Delete"
  | "Escape"
  | "Up"
  | "Down"
  | "Left"
  | "Right"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "F5"
  | "F6"
  | "F7"
  | "F8"
  | "F9"
  | "F10"
  | "F11"
  | "F12";

/** One atomic input: what a terminal sends the host. */
export type LegacyInput =
  | { kind: "key"; key: LegacyKey }
  /** One printable character. */
  | { kind: "char"; char: string }
  /** A mouse click on a cell (0-based). */
  | { kind: "click"; row: number; col: number };

export type CellStyle =
  | "normal"
  | "bright"
  | "dim"
  | "reverse"
  | "error"
  /** An input field's cells (underlined). */
  | "field";

export type Cell = { ch: string; style: CellStyle };

/** One rendered 80x24 Screen. */
export type Screen = {
  code: ScreenCode;
  /** ROWS rows of COLS cells. */
  cells: Cell[][];
  /** The text cursor, or null when no field has focus. */
  cursor: { row: number; col: number } | null;
  /** A confirmation box is open over the Screen. */
  modal: boolean;
};

/**
 * The whole machine state. Plain JSON, never mutated by `step`. Its inner
 * shape belongs to `machine.ts`; the fields below are what the harness reads.
 */
export type LegacyState = {
  fixtureId: string;
  books: Books;
  screen: ScreenCode;
  signedOn: boolean;
  /** How many times HARBOURMASTER answered an input with an error message. */
  errors: number;
  /** Atomic inputs taken so far. */
  inputs: number;
  /** Epoch ms of the last input, for the idle timeout. */
  lastInputAt: number;
  [inner: string]: unknown;
};
