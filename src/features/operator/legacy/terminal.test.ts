import { describe, expect, it } from "vitest";
import { sampleTask } from "../domain/tasks";
import type { MachineState } from "./engine";
import { boot, render } from "./machine";
import {
  cellAt,
  pointOf,
  screenHtml,
  screenText,
  TERMINAL_CSS,
} from "./terminal";
import { Session, START } from "./test-kit";
import type { CellStyle, Fixture, ScreenCode } from "./types";
import { COLS, GEOMETRY, ROWS, SCREEN_TITLES } from "./types";

const fixture = sampleTask("manifest-correction")?.fixture as Fixture;
const codes = Object.keys(SCREEN_TITLES) as ScreenCode[];

/** A click in the middle of the first cell of some text on the Screen. */
function clickOn(s: Session, needle: string, offset = 0): Session {
  const { row, col } = s.find(needle);
  const { x, y } = pointOf(row, col + offset);
  return s.act({ type: "click", x, y });
}

describe("render", () => {
  it("draws every Screen as 24 rows of 80 cells", () => {
    const base = boot(fixture, START) as MachineState;
    for (const code of codes) {
      const state = { ...base, screen: code, signedOn: true, voyage: "0377E" };
      for (const extra of [{}, { help: true }]) {
        const screen = render({ ...state, ...extra }, START);
        expect(screen.code).toBe(code);
        expect(screen.cells).toHaveLength(ROWS);
        for (const row of screen.cells) {
          expect(row).toHaveLength(COLS);
          for (const cell of row) expect(cell.ch).toHaveLength(1);
        }
        const text = screenText(screen);
        expect(text).toHaveLength(ROWS);
        for (const line of text) expect(line).toHaveLength(COLS);
        expect(text[0].startsWith(code)).toBe(true);
        if (!("help" in extra)) {
          expect(text[1]).toContain(SCREEN_TITLES[code].toUpperCase());
          expect(text[23].trim().length, code).toBeGreaterThan(0);
        }
      }
    }
  });

  it("puts the cursor in the focused field and styles errors", () => {
    const s = new Session(fixture).feed("OPR7");
    expect(s.screen.cursor).toEqual({ row: 11, col: 30 });
    s.feed("<Tab>", "NOPE", "<Enter>");
    const styles = new Set<CellStyle>(s.screen.cells[22].map((c) => c.style));
    expect(styles.has("error")).toBe(true);
    expect(s.screen.cells[11][26].style).toBe("field");
  });
});

describe("screenHtml", () => {
  it("writes 24 rows of 80 fixed cells with one cursor", () => {
    const s = new Session(fixture).feed("A<&");
    const html = screenHtml(s.screen);
    expect(html.match(/<div class="r">/g)).toHaveLength(ROWS);
    expect(html.match(/<span class="c[ "]/g)).toHaveLength(ROWS * COLS);
    expect(html.match(/ cur"/g)).toHaveLength(1);
    expect(html).toContain("&lt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("s-field");
    expect(html).toContain("s-reverse");
  });

  it("sizes the container and the cells from GEOMETRY", () => {
    expect(TERMINAL_CSS).toContain(`width: ${GEOMETRY.width}px`);
    expect(TERMINAL_CSS).toContain(`height: ${GEOMETRY.height}px`);
    expect(TERMINAL_CSS).toContain(`width: ${GEOMETRY.cellW}px`);
    expect(TERMINAL_CSS).toContain(`line-height: ${GEOMETRY.cellH}px`);
    expect(TERMINAL_CSS).toContain('"IBM Plex Mono"');
    expect(TERMINAL_CSS).toContain("@keyframes hm-blink");
  });
});

describe("cellAt and pointOf", () => {
  it("round-trip for every cell and stay inside the viewport", () => {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const { x, y } = pointOf(row, col);
        expect(cellAt(x, y)).toEqual({ row, col });
        expect(x).toBeLessThan(GEOMETRY.width);
        expect(y).toBeLessThan(GEOMETRY.height);
      }
    }
  });

  it("answers null outside the grid", () => {
    expect(cellAt(0, 0)).toBeNull();
    expect(cellAt(GEOMETRY.originX - 1, GEOMETRY.originY)).toBeNull();
    expect(cellAt(GEOMETRY.originX, GEOMETRY.originY)).toEqual({
      row: 0,
      col: 0,
    });
    expect(
      cellAt(GEOMETRY.originX + COLS * GEOMETRY.cellW, GEOMETRY.originY),
    ).toBeNull();
    expect(
      cellAt(GEOMETRY.originX, GEOMETRY.originY + ROWS * GEOMETRY.cellH),
    ).toBeNull();
  });
});

describe("clicks", () => {
  it("focus a field", () => {
    const s = new Session(fixture).feed("OPR7");
    clickOn(s, "PWD", 22).feed("MERIDIA1");
    expect(s.text[12]).toContain("********");
    clickOn(s, "ENTER=SIGN ON", 3);
    expect(s.state.screen).toBe("HMM100");
  });

  it("press a legend item", () => {
    const s = new Session(fixture).signOn();
    clickOn(s, "F3=SIGN OFF", 4);
    expect(s.state).toMatchObject({ screen: "HMS000", signedOn: false });
  });

  it("choose a menu option", () => {
    const s = new Session(fixture).signOn();
    clickOn(s, "CARGO MANIFEST", 2);
    expect(s.state.screen).toBe("HMC300");
  });

  it("answer a confirm box, and do nothing beside its buttons", () => {
    const s = new Session(fixture).signOn();
    s.feed("2", "<Enter>", "0377E", "<Enter>", "<F4>", "12", "<Enter>");
    clickOn(s, "CONFIRM DELETE");
    expect(s.screen.modal).toBe(true);
    clickOn(s, "[ N ]", 2);
    expect(s.screen.modal).toBe(false);
    expect(s.state.books.lines).toHaveLength(fixture.books.lines.length);
    s.feed("<Enter>");
    clickOn(s, "[ Y ]", 2);
    expect(s.message).toBe("HM0312 LINE 12 DELETED");
    expect(s.state.errors).toBe(0);
  });

  it("outside the grid send nothing", () => {
    const s = new Session(fixture).act({ type: "click", x: 5, y: 5 });
    expect(s.state.inputs).toBe(0);
  });
});
