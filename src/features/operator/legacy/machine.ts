import { cloneBooks } from "./books";
import {
  type Field,
  focusedField,
  LABEL_COL,
  LEGEND_ROW,
  legendLayout,
  legendText,
  type MachineState,
  MESSAGE_ROW,
  MODAL,
  modalAnswerCol,
  open,
  portClock,
  say,
} from "./engine";
import { MANUAL } from "./manual";
import { SCREENS } from "./screens";
import {
  type Cell,
  type CellStyle,
  COLS,
  type Fixture,
  type LegacyInput,
  type LegacyKey,
  type LegacyState,
  ROWS,
  SCREEN_TITLES,
  type Screen,
} from "./types";

/**
 * HARBOURMASTER as a pure state machine: `boot` a Fixture, `step` one input
 * at a time, `render` the 80x24 Screen. Time comes in as `now` (epoch ms);
 * the state is plain JSON and is never mutated.
 */

const SYSTEM_NAME = "HARBOURMASTER - PORT AUTHORITY OF MERIDIA";
const HELP_ROWS = 19;

export function boot(fixture: Fixture, now: number): LegacyState {
  const state: MachineState = {
    fixtureId: fixture.id,
    books: cloneBooks(fixture.books),
    screen: "HMS000",
    signedOn: false,
    errors: 0,
    inputs: 0,
    lastInputAt: now,
    bootAt: now,
    portTime: fixture.portTime,
    operator: { ...fixture.operator },
    idleSeconds: fixture.idleSeconds,
    locks: fixture.locks.map((l) => ({ ...l })),
    message: null,
    values: {},
    focus: null,
    pending: false,
    modal: null,
    help: false,
    page: 0,
    voyage: "",
    editLine: 0,
    prompt: "sel",
    shown: "",
  };
  return state;
}

/** A signed-on session left idle too long is closed; the Books stay. */
function expire(s: MachineState, now: number): MachineState {
  if (!s.signedOn || now - s.lastInputAt <= s.idleSeconds * 1000) return s;
  const closed = open(s, "HMX990", {
    signedOn: false,
    voyage: "",
    editLine: 0,
    shown: "",
  });
  return say(closed, "HM0990");
}

export function step(
  state: LegacyState,
  input: LegacyInput,
  now: number,
): LegacyState {
  const s = state as MachineState;
  const counted = { inputs: s.inputs + 1, lastInputAt: now };
  const expired = expire(s, now);
  // The input that finds the session closed is swallowed.
  if (expired !== s) return { ...expired, ...counted };
  return { ...apply(s, input), ...counted };
}

function apply(s: MachineState, input: LegacyInput): MachineState {
  if (s.help) return { ...s, help: false };
  if (s.modal) return answerModal(s, input);
  if (input.kind === "click") return click(s, input.row, input.col);
  if (input.kind === "char") return typeChar(s, input.char);
  return pressKey(s, input.key);
}

// Fields ---------------------------------------------------------------------------------------

function typeChar(s: MachineState, char: string): MachineState {
  if (s.screen === "HMX990") return s;
  if (s.pending) return say(s, "HM0212");
  const field = focusedField(s, SCREENS[s.screen].fields(s));
  if (!field) return say(s, "HM0002");
  const value = s.values[field.id] ?? "";
  // Past the field's width the character is dropped, with no message.
  if (value.length >= field.width || char.length !== 1) return s;
  return {
    ...s,
    values: { ...s.values, [field.id]: value + char.toUpperCase() },
  };
}

/** The keys the form engine answers itself; null hands the key to the Screen. */
function editKey(s: MachineState, key: LegacyKey): MachineState | null {
  const fields = SCREENS[s.screen].fields(s);
  const field = focusedField(s, fields);
  if (!field) return null;
  const move = (by: number): MachineState => {
    if (s.pending) return s;
    const at = fields.indexOf(field);
    const next = fields[(at + by + fields.length) % fields.length];
    return { ...s, focus: next.id };
  };
  switch (key) {
    case "Tab":
    case "Down":
      return move(1);
    case "BackTab":
    case "Up":
      return move(-1);
    case "Home":
      return s.pending ? s : { ...s, focus: fields[0].id };
    case "Left":
    case "Right":
    case "End":
      return s;
    case "Backspace":
    case "Delete": {
      if (s.pending) return say(s, "HM0212");
      const value = s.values[field.id] ?? "";
      const kept = key === "Delete" ? "" : value.slice(0, -1);
      return { ...s, values: { ...s.values, [field.id]: kept } };
    }
    default:
      return null;
  }
}

function pressKey(s: MachineState, key: LegacyKey): MachineState {
  if (s.screen !== "HMX990") {
    if (key === "F1") return { ...s, help: true };
    if (key === "F5") return { ...s, message: null };
  }
  return editKey(s, key) ?? SCREENS[s.screen].key(s, key) ?? say(s, "HM0002");
}

// Clicks ---------------------------------------------------------------------------------------

const within = (col: number, start: number, width: number) =>
  col >= start && col < start + width;

function click(s: MachineState, row: number, col: number): MachineState {
  const spec = SCREENS[s.screen];
  if (row === LEGEND_ROW) {
    const hit = legendLayout(spec.legend(s)).find((l) =>
      within(col, l.col, l.width),
    );
    return hit ? pressKey(s, hit.item.key) : s;
  }
  const spot = spec
    .hotspots?.(s)
    .find((h) => h.row === row && within(col, h.col, h.width));
  if (spot) return spot.inputs.reduce(apply, s);
  const field = spec
    .fields(s)
    .find((f) => f.row === row && within(col, f.col, f.width));
  return field && !s.pending ? { ...s, focus: field.id } : s;
}

// The confirm box ------------------------------------------------------------------------------

function answerModal(s: MachineState, input: LegacyInput): MachineState {
  const modal = s.modal;
  if (!modal) return s;
  const yes = (): MachineState =>
    SCREENS[s.screen].confirm?.({ ...s, modal: null }, modal.action) ?? s;
  const no = (): MachineState => say({ ...s, modal: null }, "HM0009");
  if (input.kind === "click") {
    if (input.row !== MODAL.buttonRow) return s;
    if (within(input.col, MODAL.yesCol, MODAL.yes.length)) return yes();
    if (within(input.col, MODAL.noCol, MODAL.no.length)) return no();
    return s;
  }
  if (input.kind === "char") {
    if (modal.answer.length >= 1) return s;
    return { ...s, modal: { ...modal, answer: input.char.toUpperCase() } };
  }
  switch (input.key) {
    case "Backspace":
    case "Delete":
      return { ...s, modal: { ...modal, answer: "" } };
    case "Escape":
    case "F12":
      return no();
    case "Enter":
      if (modal.answer === "Y") return yes();
      if (modal.answer === "N") return no();
      return say({ ...s, modal: { ...modal, answer: "" } }, "HM0010");
    default:
      return say(s, "HM0002");
  }
}

// Rendering ------------------------------------------------------------------------------------

function labelOf(field: Field): { col: number; text: string } {
  if (field.arrow) {
    const text = `${field.label} ===> `;
    return { col: field.col - text.length, text };
  }
  const width = field.col - LABEL_COL - 1;
  return { col: LABEL_COL, text: `${field.label} `.padEnd(width, ".") };
}

export function render(state: LegacyState, now: number): Screen {
  const s = expire(state as MachineState, now);
  const spec = SCREENS[s.screen];
  const cells: Cell[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, (): Cell => ({ ch: " ", style: "normal" })),
  );
  const put = (
    row: number,
    col: number,
    text: string,
    style: CellStyle = "normal",
  ) => {
    for (let i = 0; i < text.length; i += 1) {
      if (row < 0 || row >= ROWS || col + i < 0 || col + i >= COLS) continue;
      cells[row][col + i] = { ch: text[i], style };
    }
  };
  const centre = (row: number, text: string, style: CellStyle) =>
    put(row, Math.floor((COLS - text.length) / 2), text, style);

  put(0, 0, s.screen, "bright");
  centre(0, SYSTEM_NAME, "bright");
  const clock = portClock(s, now);
  put(0, COLS - clock.length, clock);
  centre(1, SCREEN_TITLES[s.screen].toUpperCase(), "normal");
  if (s.signedOn) {
    const who = `OPR ${s.operator.id.toUpperCase()}`;
    put(1, COLS - who.length, who, "dim");
  }

  spec.paint(s, put);
  const fields = spec.fields(s);
  for (const field of fields) {
    const label = labelOf(field);
    put(field.row, label.col, label.text);
    const value = s.values[field.id] ?? "";
    const shown = field.masked ? "*".repeat(value.length) : value;
    put(
      field.row,
      field.col,
      shown.padEnd(field.width, s.pending ? " " : "_"),
      s.pending ? "bright" : "field",
    );
  }
  if (s.message) {
    put(MESSAGE_ROW, 1, s.message.text, s.message.error ? "error" : "bright");
  }
  for (const placed of legendLayout(spec.legend(s))) {
    put(LEGEND_ROW, placed.col, legendText(placed.item), "reverse");
  }

  let cursor: Screen["cursor"] = null;
  const focused = focusedField(s, fields);
  if (focused && !s.pending) {
    const length = (s.values[focused.id] ?? "").length;
    cursor = {
      row: focused.row,
      col: focused.col + Math.min(length, focused.width - 1),
    };
  }

  if (s.modal) {
    const inner = MODAL.width - 2;
    const edge = `+${"-".repeat(inner)}+`;
    for (let i = 0; i < MODAL.height; i += 1) {
      const row = MODAL.top + i;
      const last = i === 0 || i === MODAL.height - 1;
      put(row, MODAL.left, last ? edge : `|${" ".repeat(inner)}|`, "bright");
    }
    put(MODAL.textRow, MODAL.left + 3, s.modal.text, "bright");
    put(MODAL.answerRow, MODAL.left + 3, MODAL.answerLabel, "bright");
    put(
      MODAL.answerRow,
      modalAnswerCol,
      s.modal.answer.padEnd(1, "_"),
      "field",
    );
    put(MODAL.buttonRow, MODAL.yesCol, MODAL.yes, "reverse");
    put(MODAL.buttonRow, MODAL.noCol, MODAL.no, "reverse");
    cursor = { row: MODAL.answerRow, col: modalAnswerCol };
  }

  if (s.help) {
    const lines = MANUAL[s.screen].split("\n").slice(0, HELP_ROWS);
    for (let row = 2; row < MESSAGE_ROW; row += 1) {
      put(row, 0, " ".repeat(COLS));
      put(row, 2, lines[row - 2] ?? "", row === 2 ? "bright" : "normal");
    }
    put(MESSAGE_ROW - 1, 2, "PRESS ANY KEY TO RETURN", "reverse");
    cursor = null;
  }

  return { code: s.screen, cells, cursor, modal: s.modal !== null };
}
