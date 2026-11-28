import { describe, expect, it } from "vitest";
import { sampleTask } from "../domain/tasks";
import { cellAt, pointOf, TERMINAL_CSS } from "./terminal";
import { Session } from "./test-kit";
import type { Fixture } from "./types";
import { COLS, GEOMETRY, ROWS } from "./types";

const fixture = sampleTask("manifest-correction")?.fixture as Fixture;

/** A click in the middle of the first cell of some text on the Screen. */
function clickOn(s: Session, needle: string, offset = 0): Session {
  const { row, col } = s.find(needle);
  const { x, y } = pointOf(row, col + offset);
  return s.act({ type: "click", x, y });
}

describe("the terminal's layout", () => {
  // A click is mapped to a cell by GEOMETRY; the browser lays the cells out by this CSS.
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
