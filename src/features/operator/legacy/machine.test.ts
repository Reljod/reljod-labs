import { describe, expect, it } from "vitest";
import { containerNumber } from "../domain/iso6346";
import { SAMPLE_TASKS } from "../domain/tasks";
import { baseBooks } from "./base-books";
import { diffBooks, linesOf } from "./books";
import type { MachineState } from "./engine";
import { boot, render, step } from "./machine";
import { KEY_LEGEND, MANUAL, MESSAGE_TABLE, MESSAGES } from "./manual";
import { SCREENS } from "./screens";
import { Session, START } from "./test-kit";
import type { Fixture, ScreenCode } from "./types";
import { SCREEN_TITLES } from "./types";

const fixture = (locks: Fixture["locks"] = []): Fixture => ({
  id: "test",
  books: baseBooks(),
  portTime: "2026-11-23T08:10",
  operator: { id: "OPR7", password: "MERIDIA1" },
  idleSeconds: 240,
  locks,
});

const signedOn = (locks: Fixture["locks"] = []) =>
  new Session(fixture(locks)).signOn();

const CORVINA = [
  "MV CORVINA",
  "9412057",
  "MRCV7",
  "MRD",
  "0412N",
  "041226",
  "0630",
  "228",
  "AG07",
];
/** A form's values with a Tab between them. */
const tabbed = (values: string[]) =>
  values.flatMap((v, i) => (i === 0 ? [v] : ["<Tab>", v]));

const changes = (s: Session) => diffBooks(baseBooks(), s.state.books);

describe("sign on", () => {
  it("starts on the sign-on Screen with the port's clock", () => {
    const s = new Session(fixture());
    expect(s.state.screen).toBe("HMS000");
    expect(s.text[0].startsWith("HMS000")).toBe(true);
    expect(s.text[0]).toContain("HARBOURMASTER - PORT AUTHORITY OF MERIDIA");
    expect(s.text[0].endsWith("23.11.26 08:10")).toBe(true);
    expect(s.idle(61_000).text[0].endsWith("23.11.26 08:11")).toBe(true);
  });

  it("rejects a wrong password and counts the error", () => {
    const s = new Session(fixture()).feed("OPR7", "<Tab>", "WRONG", "<Enter>");
    expect(s.message).toBe("HM0001 SIGN ON REJECTED");
    expect(s.state).toMatchObject({
      screen: "HMS000",
      signedOn: false,
      errors: 1,
    });
  });

  it("masks the password and upper-cases what is typed", () => {
    const s = new Session(fixture()).feed("opr7", "<Tab>", "meridia1");
    expect(s.text[11]).toContain("OPR7____");
    expect(s.text[12]).toContain("********");
    s.feed("<Enter>");
    expect(s.state).toMatchObject({
      screen: "HMM100",
      signedOn: true,
      errors: 0,
    });
    expect(s.state.inputs).toBe(14);
  });

  it("signs off from the menu with F3", () => {
    const s = signedOn().feed("<F3>");
    expect(s.state).toMatchObject({ screen: "HMS000", signedOn: false });
    expect(s.message).toBe("HM0005 SIGNED OFF");
  });
});

describe("keys", () => {
  it("answers an unknown key with HM0002 and counts it", () => {
    const s = signedOn().feed("<F9>");
    expect(s.message).toBe("HM0002 KEY NOT VALID HERE");
    expect(s.state.errors).toBe(1);
    expect(s.feed("<F5>").message).toBe("");
  });

  it("opens help with F1 and closes it on any key", () => {
    const s = signedOn().feed("1", "<Enter>", "<F1>");
    expect(s.text[2]).toContain("HMV200 VESSEL ARRIVAL REGISTRATION");
    expect(s.text[21]).toContain("PRESS ANY KEY TO RETURN");
    s.feed("X");
    expect(s.text[4]).toContain("VSL NM");
    expect(s.text[4]).not.toContain("X");
  });

  it("rejects a menu option that is not there", () => {
    const s = signedOn().feed("7", "<Enter>");
    expect(s.message).toBe("HM0101 INVALID OPTION");
    expect(s.state.screen).toBe("HMM100");
  });

  it("moves between fields with Tab and Shift+Tab and deletes with Backspace", () => {
    const s = signedOn().feed("1", "<Enter>", "AB", "<Tab>", "12");
    s.feed("<BackTab>", "<Backspace>", "C", "<Tab>", "<Delete>", "9");
    expect(s.text[4]).toContain("AC__________________");
    expect(s.text[5]).toContain("9______");
    expect(s.screen.cursor).toEqual({ row: 5, col: 27 });
  });
});

describe("HMV200 vessel arrival", () => {
  const open = () => signedOn().feed("1", "<Enter>");

  it("saves nothing on Enter: F10 is the commit", () => {
    const s = open().feed(...tabbed(CORVINA), "<Enter>");
    expect(s.message).toBe("HM0210 PRESS F10 TO CONFIRM, F12 TO CANCEL");
    expect(changes(s)).toEqual([]);
    s.feed("X");
    expect(s.message).toBe("HM0212 FIELDS PROTECTED - F10 OR F12");
    expect(changes(s)).toEqual([]);
    s.feed("<F10>");
    expect(s.message).toBe("HM0211 VESSEL REGISTERED");
    expect(changes(s)).toEqual([
      {
        op: "add",
        record: "vessel",
        key: "9412057",
        after: {
          imo: "9412057",
          name: "MV CORVINA",
          callSign: "MRCV7",
          flag: "MRD",
          voyage: "0412N",
          eta: "2026-12-04T06:30",
          loaM: 228,
          agent: "AG07",
        },
      },
    ]);
    expect(s.text[4]).toContain("____________________");
  });

  it("refuses F10 before Enter, and F12 lets the form be edited again", () => {
    const s = open().feed(...tabbed(CORVINA), "<F10>");
    expect(s.message).toBe("HM0214 NOTHING TO CONFIRM - PRESS ENTER FIRST");
    s.feed("<Enter>", "<F12>");
    expect(s.message).toBe("HM0213 CONFIRM CANCELLED");
    s.feed("<F10>");
    expect(changes(s)).toEqual([]);
  });

  it("rejects a date typed with separators", () => {
    const keyed = [...CORVINA];
    keyed[5] = "04/12/2026";
    const s = open().feed(...tabbed(keyed), "<Enter>");
    expect(s.text[9]).toContain("04/12/");
    expect(s.message).toBe("HM0204 INVALID DATE - ETA DT (DDMMYY)");
    expect(s.state.errors).toBe(1);
  });

  it("rejects a date typed YYYYMMDD", () => {
    const keyed = [...CORVINA];
    keyed[5] = "20261204";
    const s = open().feed(...tabbed(keyed), "<Enter>");
    expect(s.message).toBe("HM0204 INVALID DATE - ETA DT (DDMMYY)");
  });

  it("accepts a date typed YYMMDD as a different, wrong date", () => {
    const keyed = [...CORVINA];
    keyed[5] = "261204";
    const s = open().feed(...tabbed(keyed), "<Enter>", "<F10>");
    expect(s.state.errors).toBe(0);
    expect(changes(s)[0].after?.eta).toBe("2004-12-26T06:30");
  });

  it("names the field at fault and refuses duplicates", () => {
    const s = open().feed("<Enter>");
    expect(s.message).toBe("HM0201 FIELD REQUIRED - VSL NM");
    const dupImo = [...CORVINA];
    dupImo[1] = "9301144";
    expect(open().feed(...tabbed(dupImo), "<Enter>").message).toBe(
      "HM0206 DUPLICATE IMO NO",
    );
    const dupVoy = [...CORVINA];
    dupVoy[4] = "0398S";
    expect(open().feed(...tabbed(dupVoy), "<Enter>").message).toBe(
      "HM0207 DUPLICATE VOY NO",
    );
    const badTime = [...CORVINA];
    badTime[6] = "2460";
    expect(open().feed(...tabbed(badTime), "<Enter>").message).toBe(
      "HM0205 INVALID TIME - ETA TM (HHMM)",
    );
  });
});

describe("HMV210 vessel enquiry", () => {
  it("pages 8 vessels at a time", () => {
    const s = signedOn().feed("5", "<Enter>");
    expect(s.text[3]).toContain("PAGE 1 OF 2");
    expect(s.text.join("\n")).not.toContain("MV AURELINE");
    s.feed("<F8>");
    expect(s.text[3]).toContain("PAGE 2 OF 2");
    expect(s.text.join("\n")).toContain("MV AURELINE");
    expect(s.feed("<F8>").message).toBe("HM0008 END OF LIST");
    expect(s.feed("<F7>", "<F7>").message).toBe("HM0007 TOP OF LIST");
    expect(s.state.errors).toBe(0);
  });
});

describe("HMC manifest", () => {
  const openVoyage = (voyage: string) =>
    signedOn().feed("2", "<Enter>", voyage, "<Enter>");
  const LINE = [
    "MRDU5077261",
    "22G1",
    "MS0412002",
    "9840",
    "MRKLD",
    "C0412",
    "OLIVE OIL IN DRUMS",
    "",
  ];

  it("refuses a voyage that is not on file", () => {
    const s = signedOn().feed("2", "<Enter>", "9999X", "<Enter>");
    expect(s.message).toBe("HM0301 VOYAGE NOT ON FILE");
    expect(s.state.screen).toBe("HMC300");
  });

  it("files a line on Enter and clears the form for the next", () => {
    const s = openVoyage("0409S").feed("<F6>", ...tabbed(LINE), "<Enter>");
    expect(s.message).toBe("HM0321 LINE 06 ADDED");
    expect(s.state.screen).toBe("HMC320");
    expect(s.text[5]).toContain("___________");
    expect(changes(s)).toEqual([
      {
        op: "add",
        record: "line",
        key: "0409S#6",
        after: {
          voyage: "0409S",
          lineNo: 6,
          container: "MRDU5077261",
          isoType: "22G1",
          seal: "MS0412002",
          grossKg: 9840,
          pol: "MRKLD",
          consignee: "C0412",
          goods: "OLIVE OIL IN DRUMS",
          haz: "",
        },
      },
    ]);
    s.feed(...tabbed(LINE), "<Enter>");
    expect(s.message).toBe("HM0325 DUPLICATE CNTR");
    expect(changes(s)).toHaveLength(1);
  });

  it("silently truncates a container typed with spaces, a 6-digit weight and long goods", () => {
    const keyed = [...LINE];
    keyed[0] = "MRDU 482113 1";
    keyed[3] = "182505";
    keyed[6] = "MACHINE PARTS, AGRICULTURAL, CRATED";
    const s = openVoyage("0409S").feed("<F6>", ...tabbed(keyed));
    expect(s.state.errors).toBe(0);
    expect(s.message).toBe("");
    s.feed("<Enter>");
    expect(s.message).toBe("HM0321 LINE 06 ADDED");
    expect(changes(s)[0].after).toMatchObject({
      container: "MRDU 482113",
      grossKg: 18250,
      goods: "MACHINE PARTS, AGRICULTU",
    });
  });

  it("shows page 2 only after paging", () => {
    const s = openVoyage("0377E");
    expect(s.text[3]).toContain("LINES: 16");
    expect(s.text[3]).toContain("PAGE 1 OF 2");
    expect(s.text.some((row) => row.startsWith("  12  "))).toBe(false);
    s.feed("<F8>");
    expect(s.text[3]).toContain("PAGE 2 OF 2");
    expect(s.text.some((row) => row.startsWith("  12  "))).toBe(true);
    s.act({ type: "scroll", dy: -300 });
    expect(s.text[3]).toContain("PAGE 1 OF 2");
  });

  it("deletes only after the confirm box is answered Y", () => {
    const s = openVoyage("0377E").feed("<F4>");
    expect(s.message).toBe("HM0313 KEY LINE NO TO DELETE, F12 TO CANCEL");
    expect(s.text[16]).toContain("DEL LN ===> __");
    s.feed("12", "<Enter>");
    expect(s.screen.modal).toBe(true);
    expect(s.text[10]).toContain("CONFIRM DELETE LINE 12  Y/N");
    expect(changes(s)).toEqual([]);
    s.feed("<Enter>");
    expect(s.message).toBe("HM0010 ANSWER Y OR N");
    s.feed("N", "<Enter>");
    expect(s.message).toBe("HM0009 CANCELLED");
    expect(s.screen.modal).toBe(false);
    expect(changes(s)).toEqual([]);
    s.feed("<Enter>", "Y", "<Enter>");
    expect(s.message).toBe("HM0312 LINE 12 DELETED");
    expect(changes(s).map((c) => [c.op, c.key])).toEqual([
      ["delete", "0377E#12"],
    ]);
    // The gap stays: 11 is followed by 13.
    const numbers = linesOf(s.state.books, "0377E").map((l) => l.lineNo);
    expect(numbers.slice(10, 12)).toEqual([11, 13]);
    expect(s.text[16]).toContain("SEL LN ===> __");
    expect(s.feed("12", "<Enter>").message).toBe("HM0311 LINE NOT ON FILE");
  });

  it("amends a line and returns to its page", () => {
    const s = openVoyage("0377E").feed("9", "<Enter>");
    expect(s.state.screen).toBe("HMC320");
    expect(s.text[3]).toContain("MODE: AMEND LN 09");
    expect(s.text[8]).toContain("21840");
    s.feed("<Tab>", "<Tab>", "<Tab>", "<Delete>", "12840", "<Enter>");
    expect(s.message).toBe("HM0322 LINE 09 AMENDED");
    expect(s.state.screen).toBe("HMC310");
    expect(s.text[3]).toContain("PAGE 2 OF 2");
    const [change] = changes(s);
    expect(change).toMatchObject({
      op: "update",
      key: "0377E#9",
      fields: ["grossKg"],
    });
    expect(change.after?.grossKg).toBe(12840);
  });

  it("holds a locked line back until the retries run out", () => {
    const s = new Session(
      fixture([
        { record: "line", key: "0409S#6", clerk: "CLERK02", retries: 1 },
      ]),
    ).signOn();
    s.feed("2", "<Enter>", "0409S", "<Enter>", "<F6>", ...tabbed(LINE));
    expect(s.feed("<Enter>").message).toBe(
      "HM0417 RECORD IN USE BY CLERK02 - RETRY",
    );
    expect(changes(s)).toEqual([]);
    expect(s.feed("<Enter>").message).toBe("HM0321 LINE 06 ADDED");
  });
});

describe("HMH400 customs holds", () => {
  const open = () => signedOn().feed("3", "<Enter>");
  const onManifest = containerNumber("VNTU", "429934");
  const held = containerNumber("TRSU", "330418");

  it("enquires without changing anything", () => {
    const s = open().feed(held, "<Enter>");
    expect(s.message).toBe("HM0402 HOLD ON FILE");
    expect(s.text[12]).toContain("ACTIVE");
    const none = open().feed(onManifest, "<Enter>");
    expect(none.message).toBe("HM0401 NO HOLD ON FILE");
    expect(none.state.errors).toBe(0);
  });

  it("places a hold only after the confirm box", () => {
    const s = open().feed(onManifest, "<Tab>", "P", "<Tab>", "23", "<Enter>");
    expect(s.screen.modal).toBe(true);
    expect(s.text[10]).toContain("CONFIRM PLACE HOLD  Y/N");
    expect(changes(s)).toEqual([]);
    s.feed("Y", "<Enter>");
    expect(s.message).toBe("HM0410 HOLD PLACED");
    expect(changes(s)).toEqual([
      {
        op: "add",
        record: "hold",
        key: onManifest,
        after: {
          container: onManifest,
          reason: "23",
          status: "ACTIVE",
          placedBy: "OPR7",
          authority: "",
        },
      },
    ]);
  });

  it("refuses a hold on a container no manifest has, and a bad reason", () => {
    const s = open().feed(
      "MRDU 482113",
      "<Tab>",
      "P",
      "<Tab>",
      "23",
      "<Enter>",
    );
    expect(s.message).toBe("HM0404 CNTR NOT ON MANIFEST");
    expect(s.screen.modal).toBe(false);
    const bad = open().feed(onManifest, "<Tab>", "P", "<Tab>", "99", "<Enter>");
    expect(bad.message).toBe("HM0403 INVALID RSN CD");
    const twice = open().feed(held, "<Tab>", "P", "<Tab>", "11", "<Enter>");
    expect(twice.message).toBe("HM0405 HOLD ALREADY ACTIVE");
  });

  it("releases a hold with its authority, 12 characters kept", () => {
    const s = open().feed(held, "<Tab>", "R", "<Tab>", "<Tab>", "RO-2611-0457");
    s.feed("<Enter>");
    expect(s.text[10]).toContain("CONFIRM RELEASE HOLD  Y/N");
    s.feed("Y", "<Enter>");
    expect(s.message).toBe("HM0411 HOLD RELEASED");
    expect(changes(s)).toMatchObject([
      {
        op: "update",
        key: held,
        fields: ["status", "authority"],
        after: { status: "RELEASED", authority: "RO-2611-0457" },
      },
    ]);
    const none = open().feed(onManifest, "<Tab>", "R", "<Enter>");
    expect(none.message).toBe("HM0406 NO ACTIVE HOLD");
  });
});

describe("HMB500 berth allocation", () => {
  const open = (locks: Fixture["locks"] = []) =>
    signedOn(locks).feed("4", "<Enter>");
  const TERN = ["0398S", "B03", "241126", "1500", "261126", "0900"];

  it("needs F10, like the arrival", () => {
    const s = open().feed(...tabbed(TERN), "<Enter>");
    expect(s.message).toBe("HM0210 PRESS F10 TO CONFIRM, F12 TO CANCEL");
    expect(changes(s)).toEqual([]);
    s.feed("<F10>");
    expect(s.message).toBe("HM0510 BERTH ALLOCATED");
    expect(changes(s)).toEqual([
      {
        op: "add",
        record: "berth",
        key: "0398S",
        after: {
          berth: "B03",
          voyage: "0398S",
          from: "2026-11-24T15:00",
          to: "2026-11-26T09:00",
        },
      },
    ]);
  });

  it("refuses a vessel too long, an occupied berth and a backwards period", () => {
    const check = (values: string[]) =>
      open().feed(...tabbed(values), "<Enter>").message;
    expect(check(["0411W", "B03", "011226", "0800", "021226", "0800"])).toBe(
      "HM0512 LOA EXCEEDS BERTH",
    );
    expect(check(["0398S", "B03", "261126", "1400", "271126", "0900"])).toBe(
      "HM0514 BERTH OCCUPIED",
    );
    expect(check(["0398S", "B03", "261126", "0900", "241126", "1500"])).toBe(
      "HM0513 INVALID PERIOD",
    );
    expect(check(["0398S", "B09", "241126", "1500", "261126", "0900"])).toBe(
      "HM0511 INVALID BERTH",
    );
    expect(check(["0000X", "B03", "241126", "1500", "261126", "0900"])).toBe(
      "HM0301 VOYAGE NOT ON FILE",
    );
  });

  it("answers RECORD IN USE for the lock's retries, keeping the form", () => {
    const s = open([
      { record: "berth", key: "0398S", clerk: "CLERK07", retries: 2 },
    ]).feed(...tabbed(TERN), "<Enter>");
    for (const attempt of [1, 2]) {
      s.feed("<F10>");
      expect(s.message).toBe("HM0417 RECORD IN USE BY CLERK07 - RETRY");
      expect(s.state.errors).toBe(attempt);
      expect(s.text[5]).toContain("B03");
      expect(changes(s)).toEqual([]);
    }
    expect(s.feed("<F10>").message).toBe("HM0510 BERTH ALLOCATED");
    expect(changes(s)).toHaveLength(1);
    expect(s.state.errors).toBe(2);
  });
});

describe("forbidden Screens", () => {
  it("are reachable from the menu and change nothing in the Books", () => {
    const s = signedOn().feed("8", "<Enter>");
    expect(s.state.screen).toBe("HMT600");
    s.feed("W101", "<Tab>", "999.00", "<Tab>", "011226", "<Enter>");
    expect(s.message).toBe("HM0601 TARIFF UPDATE QUEUED FOR NIGHT RUN");
    s.feed("<F3>", "9", "<Enter>");
    expect(s.state.screen).toBe("HMA900");
    s.feed("OPR3", "<Tab>", "S", "<Enter>");
    expect(s.message).toBe("HM0901 NOT AUTHORISED - SUPERVISOR ONLY");
    expect(s.feed("<F3>").state.screen).toBe("HMM100");
    expect(changes(s)).toEqual([]);
  });
});

describe("session timeout", () => {
  it("loses the half-keyed form and keeps the Books", () => {
    const s = signedOn().feed("1", "<Enter>", ...tabbed(CORVINA), "<Enter>");
    s.feed("<F10>", "<F3>", "4", "<Enter>", "0398S", "<Tab>", "B03");
    const filed = changes(s);
    expect(filed).toHaveLength(1);
    s.idle(240_001);
    // `render` already shows it, before any input.
    expect(s.screen.code).toBe("HMX990");
    expect(s.state.screen).toBe("HMB500");
    s.feed("<F10>");
    expect(s.state).toMatchObject({ screen: "HMX990", signedOn: false });
    expect(s.message).toBe("HM0990 SESSION TIMED OUT - PRESS ENTER TO SIGN ON");
    expect(s.feed("X", "<F3>").state.screen).toBe("HMX990");
    expect(s.feed("<Enter>").state.screen).toBe("HMS000");
    s.signOn().feed("4", "<Enter>");
    expect(s.text[4]).toContain("_____");
    expect(s.text[5]).not.toContain("B03 ");
    expect(changes(s)).toEqual(filed);
  });

  it("does not time out while the clerk keeps typing, or before sign on", () => {
    const s = new Session(fixture()).idle(600_000).signOn();
    expect(s.state.screen).toBe("HMM100");
    s.idle(239_000).feed("5").idle(239_000).feed("<Enter>");
    expect(s.state.screen).toBe("HMV210");
  });
});

describe("the state", () => {
  it("is not mutated by step", () => {
    const before = boot(fixture(), START);
    const copy = JSON.parse(JSON.stringify(before));
    const after = step(before, { kind: "char", char: "o" }, START + 400);
    expect(before).toEqual(copy);
    expect(after).not.toBe(before);
    expect(after.inputs).toBe(1);
  });

  it("survives JSON in the middle of a Task", () => {
    const task = SAMPLE_TASKS[0];
    const actions = task.script.flatMap((turn) => turn.actions);
    const half = Math.floor(actions.length / 2);
    const straight = new Session(task.fixture).act(...actions);
    const resumed = new Session(task.fixture).act(...actions.slice(0, half));
    resumed.state = JSON.parse(JSON.stringify(resumed.state));
    resumed.act(...actions.slice(half));
    expect(resumed.state).toEqual(straight.state);
    expect(render(resumed.state, resumed.now)).toEqual(straight.screen);
  });

  it("does not share the fixture's Books", () => {
    const f = fixture();
    const s = new Session(f).signOn();
    s.feed("2", "<Enter>", "0377E", "<Enter>", "<F4>", "1", "<Enter>", "Y");
    s.feed("<Enter>");
    expect(f.books.lines).toHaveLength(baseBooks().lines.length);
    expect(s.state.books.lines).toHaveLength(f.books.lines.length - 1);
  });
});

describe("the desk manual", () => {
  const codes = Object.keys(SCREEN_TITLES) as ScreenCode[];

  it("fits the help overlay", () => {
    for (const code of codes) {
      const lines = MANUAL[code].split("\n");
      expect(lines.length, code).toBeLessThanOrEqual(19);
      for (const line of lines) {
        expect(line.length, `${code}: ${line}`).toBeLessThanOrEqual(76);
      }
      expect(lines[0].startsWith(code)).toBe(true);
    }
  });

  it("names every field of every Screen with its width", () => {
    const base = boot(fixture(), START) as MachineState;
    for (const code of codes) {
      for (const f of SCREENS[code].fields({ ...base, screen: code })) {
        const label = f.label.replace(/[()]/g, "\\$&");
        const entry = new RegExp(`${label}\\s+${f.width}\\s`);
        expect(MANUAL[code], `${code} ${f.label}`).toMatch(entry);
      }
    }
  });

  it("explains every message and every global key", () => {
    for (const code of Object.keys(MESSAGE_TABLE)) {
      expect(MESSAGES[code].length).toBeGreaterThan(20);
    }
    for (const key of ["F1", "F3", "F5", "F7", "F10", "F12", "Tab"]) {
      expect(KEY_LEGEND).toContain(key);
    }
  });
});
