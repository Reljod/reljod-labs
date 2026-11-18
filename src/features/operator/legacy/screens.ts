import { bookingOf, holdOn, lineKey, linesOf, vesselByVoyage } from "./books";
import {
  type Field,
  type LegendItem,
  LIST_ROWS,
  type MachineState,
  open,
  pageCount,
  parseDate,
  parseTime,
  refusedByLock,
  reject,
  type ScreenSpec,
  say,
  showStamp,
  turnPage,
  val,
} from "./engine";
import type { MessageCode } from "./manual";
import type {
  BerthBooking,
  Hold,
  LegacyKey,
  ManifestLine,
  ScreenCode,
  Vessel,
} from "./types";

/** The Screens of HARBOURMASTER. Each is fields, a legend, paint and keys. */

const FIELD_COL = 26;

function field(
  id: string,
  label: string,
  row: number,
  width: number,
  extra: Partial<Field> = {},
): Field {
  return { id, label, row, col: FIELD_COL, width, ...extra };
}

const item = (key: LegacyKey, label: string): LegendItem => ({ key, label });
const HELP = item("F1", "HELP");
const EXIT = item("F3", "EXIT");
const REFRESH = item("F5", "REFRESH");

/** Berths and the longest vessel (LOA, metres) each takes. */
export const BERTHS: Record<string, number> = {
  B01: 180,
  B02: 220,
  B03: 260,
  B04: 300,
  B05: 340,
  B06: 400,
};

/** Customs hold reason codes. */
export const REASONS: Record<string, string> = {
  "11": "DOCS",
  "23": "XRAY",
  "41": "VALN",
  "57": "QUAR",
};

export const MENU: { option: string; label: string; screen: ScreenCode }[] = [
  { option: "1", label: "VESSEL ARRIVALS", screen: "HMV200" },
  { option: "2", label: "CARGO MANIFEST", screen: "HMC300" },
  { option: "3", label: "CUSTOMS HOLDS", screen: "HMH400" },
  { option: "4", label: "BERTH ALLOCATION", screen: "HMB500" },
  { option: "5", label: "VESSEL ENQUIRY", screen: "HMV210" },
  { option: "8", label: "TARIFF MAINT", screen: "HMT600" },
  { option: "9", label: "ADMINISTRATION", screen: "HMA900" },
];
const MENU_ROW = 5;
const MENU_COL = 24;

/** The first required field left empty, as a rejected state; null when none is. */
function missing(s: MachineState, fields: Field[]): MachineState | null {
  const empty = fields.find((f) => val(s, f.id) === "");
  return empty ? reject(s, "HM0201", empty) : null;
}

/** Runs the checks in order; the first that fails names its field. */
function firstFailure(
  s: MachineState,
  checks: [boolean, MessageCode, Field][],
): MachineState | null {
  const failed = checks.find(([ok]) => !ok);
  return failed ? reject(s, failed[1], failed[2]) : null;
}

/** Screens with a validate-then-F10 confirm share these keys. */
function confirmKeys(
  s: MachineState,
  key: LegacyKey,
  validate: (s: MachineState) => MachineState | null,
  commit: (s: MachineState) => MachineState,
): MachineState | null {
  if (key === "F3") return open(s, "HMM100");
  if (key === "Enter") {
    if (s.pending) return say(s, "HM0210");
    return validate(s) ?? say({ ...s, pending: true }, "HM0210");
  }
  if (key === "F10") return s.pending ? commit(s) : say(s, "HM0214");
  if (key === "F12" && s.pending) {
    return say({ ...s, pending: false }, "HM0213");
  }
  return null;
}

const CONFIRM_LEGEND = [
  item("Enter", "VALIDATE"),
  HELP,
  EXIT,
  REFRESH,
  item("F10", "CONFIRM"),
  item("F12", "CANCEL"),
];

// HMS000 Sign on --------------------------------------------------------------------------------

const S = {
  opr: field("opr", "OPR ID", 11, 8),
  pwd: field("pwd", "PWD", 12, 8, { masked: true }),
};

const signOn: ScreenSpec = {
  fields: () => [S.opr, S.pwd],
  legend: () => [item("Enter", "SIGN ON"), HELP],
  paint(_s, put) {
    put(4, 22, "MANIFEST AND BERTH SYSTEM  REL 4.17", "bright");
    put(6, 22, "AUTHORISED OPERATORS ONLY. ALL INPUT");
    put(7, 22, "IS LOGGED TO THE PORT AUDIT JOURNAL.");
    put(15, 4, "KEY OPR ID AND PWD, THEN PRESS ENTER.", "dim");
  },
  key(s, key) {
    if (key !== "Enter") return null;
    const ok =
      val(s, "opr") === s.operator.id.toUpperCase() &&
      val(s, "pwd") === s.operator.password.toUpperCase();
    if (!ok) return say({ ...s, values: {}, focus: null }, "HM0001");
    return say(open(s, "HMM100", { signedOn: true }), "HM0003");
  },
};

// HMM100 Main menu --------------------------------------------------------------------------------

const M = {
  opt: { ...field("opt", "SELECT OPTION", 15, 1, { arrow: true }), col: 43 },
};

const menu: ScreenSpec = {
  fields: () => [M.opt],
  legend: () => [item("Enter", "SELECT"), HELP, item("F3", "SIGN OFF")],
  paint(_s, put) {
    MENU.forEach((m, i) => {
      put(MENU_ROW + i, MENU_COL, `${m.option}  ${m.label}`, "bright");
    });
  },
  hotspots: () =>
    MENU.map((m, i) => ({
      row: MENU_ROW + i,
      col: MENU_COL,
      width: m.label.length + 3,
      inputs: [
        { kind: "key", key: "Delete" },
        { kind: "char", char: m.option },
        { kind: "key", key: "Enter" },
      ],
    })),
  key(s, key) {
    if (key === "F3") {
      return say(open(s, "HMS000", { signedOn: false }), "HM0005");
    }
    if (key !== "Enter") return null;
    const chosen = MENU.find((m) => m.option === val(s, "opt"));
    if (!chosen) return say({ ...s, values: {} }, "HM0101");
    return open(s, chosen.screen);
  },
};

// HMV200 Vessel arrival registration ------------------------------------------------------------

const V = {
  name: field("name", "VSL NM", 4, 20),
  imo: field("imo", "IMO NO", 5, 7),
  call: field("call", "CALL SGN", 6, 7),
  flag: field("flag", "FLAG", 7, 3),
  voy: field("voy", "VOY NO", 8, 5),
  etaDt: field("etaDt", "ETA DT (DDMMYY)", 9, 6),
  etaTm: field("etaTm", "ETA TM (HHMM)", 10, 4),
  loa: field("loa", "LOA M", 11, 3),
  agent: field("agent", "AGENT", 12, 4),
};
const V_FIELDS = Object.values(V);

function vesselKeyed(s: MachineState): Vessel {
  const date = parseDate(val(s, "etaDt")) ?? "";
  const time = parseTime(val(s, "etaTm")) ?? "";
  return {
    imo: val(s, "imo"),
    name: val(s, "name"),
    callSign: val(s, "call"),
    flag: val(s, "flag"),
    voyage: val(s, "voy"),
    eta: `${date}T${time}`,
    loaM: Number(val(s, "loa")),
    agent: val(s, "agent"),
  };
}

function validateVessel(s: MachineState): MachineState | null {
  const v = (id: string) => val(s, id);
  return (
    missing(s, V_FIELDS) ??
    firstFailure(s, [
      [/^\d{7}$/.test(v("imo")), "HM0202", V.imo],
      [/^[A-Z]{3}$/.test(v("flag")), "HM0203", V.flag],
      [parseDate(v("etaDt")) !== null, "HM0204", V.etaDt],
      [parseTime(v("etaTm")) !== null, "HM0205", V.etaTm],
      [/^\d{1,3}$/.test(v("loa")) && Number(v("loa")) > 0, "HM0202", V.loa],
      [/^AG\d\d$/.test(v("agent")), "HM0203", V.agent],
      [!s.books.vessels.some((x) => x.imo === v("imo")), "HM0206", V.imo],
      [!vesselByVoyage(s.books, v("voy")), "HM0207", V.voy],
    ])
  );
}

function commitVessel(s: MachineState): MachineState {
  const vessel = vesselKeyed(s);
  const refused = refusedByLock(s, "vessel", vessel.imo);
  if (refused) return refused;
  const books = { ...s.books, vessels: [...s.books.vessels, vessel] };
  return say(open(s, "HMV200", { books }), "HM0211");
}

const arrival: ScreenSpec = {
  fields: () => V_FIELDS,
  legend: () => CONFIRM_LEGEND,
  paint(_s, put) {
    put(15, 4, "NOTHING IS FILED UNTIL F10.", "dim");
  },
  key: (s, key) => confirmKeys(s, key, validateVessel, commitVessel),
};

// HMV210 Vessel enquiry ---------------------------------------------------------------------------

const LIST_LEGEND = [
  HELP,
  EXIT,
  REFRESH,
  item("F7", "BKWD"),
  item("F8", "FWD"),
];

function pageKeys(
  s: MachineState,
  key: LegacyKey,
  total: number,
): MachineState | null {
  if (key === "F7" || key === "PageUp") return turnPage(s, total, -1);
  if (key === "F8" || key === "PageDown") return turnPage(s, total, 1);
  return null;
}

const pageLabel = (s: MachineState, total: number) =>
  `PAGE ${s.page + 1} OF ${pageCount(total)}`;

const enquiry: ScreenSpec = {
  fields: () => [],
  legend: () => LIST_LEGEND,
  paint(s, put) {
    const vessels = s.books.vessels;
    put(3, 1, `VESSELS ON FILE: ${vessels.length}`);
    put(3, 66, pageLabel(s, vessels.length), "bright");
    put(
      5,
      1,
      "VSL NM               IMO NO  CALL SG FLG VOY   ETA DT/TM      LOA AGNT",
      "dim",
    );
    vessels
      .slice(s.page * LIST_ROWS, (s.page + 1) * LIST_ROWS)
      .forEach((v, i) => {
        const row = [
          v.name.padEnd(20),
          v.imo.padEnd(7),
          v.callSign.padEnd(7),
          v.flag.padEnd(3),
          v.voyage.padEnd(5),
          showStamp(v.eta),
          String(v.loaM).padStart(3),
          v.agent,
        ].join(" ");
        put(6 + i, 1, row);
      });
  },
  key(s, key) {
    if (key === "F3") return open(s, "HMM100");
    return pageKeys(s, key, s.books.vessels.length);
  },
};

// HMC300 Manifest: pick a voyage ------------------------------------------------------------------

const C0 = { voy: field("voy", "VOY NO", 6, 5) };

const pickVoyage: ScreenSpec = {
  fields: () => [C0.voy],
  legend: () => [item("Enter", "OPEN"), HELP, EXIT, REFRESH],
  paint(_s, put) {
    put(4, 4, "KEY THE VOYAGE WHOSE MANIFEST IS WANTED.", "dim");
  },
  key(s, key) {
    if (key === "F3") return open(s, "HMM100");
    if (key !== "Enter") return null;
    const voyage = val(s, "voy");
    if (voyage === "") return reject(s, "HM0201", C0.voy);
    if (!vesselByVoyage(s.books, voyage)) return say(s, "HM0301");
    return open(s, "HMC310", { voyage });
  },
};

// HMC310 Manifest lines ---------------------------------------------------------------------------

const lnField = (s: MachineState): Field => ({
  ...field("ln", s.prompt === "del" ? "DEL LN" : "SEL LN", 16, 2, {
    arrow: true,
  }),
  col: 20,
});

/** A line's form values, as HMC320 shows them. */
function lineValues(line: ManifestLine): Record<string, string> {
  return {
    cntr: line.container,
    iso: line.isoType,
    seal: line.seal,
    wt: String(line.grossKg),
    pol: line.pol,
    cnee: line.consignee,
    goods: line.goods,
    haz: line.haz,
  };
}

const lines: ScreenSpec = {
  fields: (s) => [lnField(s)],
  legend: (s) => [
    item("Enter", s.prompt === "del" ? "DELETE" : "AMEND"),
    HELP,
    EXIT,
    item("F4", "DELETE"),
    REFRESH,
    item("F6", "ADD"),
    item("F7", "BKWD"),
    item("F8", "FWD"),
    item("F12", "CANCEL"),
  ],
  paint(s, put) {
    const all = linesOf(s.books, s.voyage);
    const vessel = vesselByVoyage(s.books, s.voyage);
    put(
      3,
      1,
      `VSL: ${vessel?.name ?? ""}   VOY: ${s.voyage}   LINES: ${all.length}`,
    );
    put(3, 66, pageLabel(s, all.length), "bright");
    put(5, 1, " LN  CNTR NO      TYPE  GR WT  CNEE   HAZ  GOODS", "dim");
    if (all.length === 0) put(7, 6, "NO LINES ON FILE");
    all.slice(s.page * LIST_ROWS, (s.page + 1) * LIST_ROWS).forEach((l, i) => {
      const row = ` ${String(l.lineNo).padStart(2, "0")}  ${l.container.padEnd(11)}  ${l.isoType.padEnd(4)}  ${String(l.grossKg).padStart(5)}  ${l.consignee.padEnd(5)}  ${l.haz.padEnd(3)}  ${l.goods.slice(0, 24)}`;
      put(6 + i, 1, row);
    });
  },
  key(s, key) {
    const all = linesOf(s.books, s.voyage);
    if (key === "F3") return open(s, "HMC300");
    if (key === "F6") return open(s, "HMC320", { editLine: 0 });
    if (key === "F4") {
      return say({ ...s, prompt: "del", values: {}, focus: null }, "HM0313");
    }
    if (key === "F12" && s.prompt === "del") {
      return say({ ...s, prompt: "sel", values: {} }, "HM0009");
    }
    if (key !== "Enter") return pageKeys(s, key, all.length);
    const keyed = val(s, "ln");
    if (keyed === "") return reject(s, "HM0201", lnField(s));
    const line = all.find((l) => l.lineNo === Number(keyed));
    if (!/^\d+$/.test(keyed) || !line) return say(s, "HM0311");
    if (s.prompt === "del") {
      const nn = String(line.lineNo).padStart(2, "0");
      return {
        ...s,
        message: null,
        modal: {
          action: "delete",
          text: `CONFIRM DELETE LINE ${nn}  Y/N`,
          answer: "",
        },
      };
    }
    return open(s, "HMC320", {
      editLine: line.lineNo,
      values: lineValues(line),
    });
  },
  confirm(s) {
    const lineNo = Number(val(s, "ln"));
    const refused = refusedByLock(s, "line", lineKey(s.voyage, lineNo));
    if (refused) return refused;
    const kept = s.books.lines.filter(
      (l) => !(l.voyage === s.voyage && l.lineNo === lineNo),
    );
    const left = kept.filter((l) => l.voyage === s.voyage).length;
    const next: MachineState = {
      ...s,
      books: { ...s.books, lines: kept },
      prompt: "sel",
      values: {},
      page: Math.min(s.page, pageCount(left) - 1),
    };
    return say(next, "HM0312", String(lineNo).padStart(2, "0"));
  },
};

// HMC320 Line entry -------------------------------------------------------------------------------

const L = {
  cntr: field("cntr", "CNTR NO", 5, 11),
  iso: field("iso", "ISO TYPE", 6, 4),
  seal: field("seal", "SEAL NO", 7, 10),
  wt: field("wt", "GR WT KG", 8, 5),
  pol: field("pol", "POL", 9, 5),
  cnee: field("cnee", "CNEE CD", 10, 5),
  goods: field("goods", "GOODS", 11, 24),
  haz: field("haz", "HAZ CL", 12, 3),
};
const L_FIELDS = Object.values(L);
const L_REQUIRED = L_FIELDS.filter((f) => f.id !== "haz");

function saveLine(s: MachineState): MachineState {
  const v = (id: string) => val(s, id);
  const others = s.books.lines.filter(
    (l) => l.voyage === s.voyage && l.lineNo !== s.editLine,
  );
  const failed =
    missing(s, L_REQUIRED) ??
    firstFailure(s, [
      [/^[0-9A-Z]{4}$/.test(v("iso")), "HM0203", L.iso],
      [/^\d{1,5}$/.test(v("wt")) && Number(v("wt")) > 0, "HM0202", L.wt],
      [/^[A-Z]{5}$/.test(v("pol")), "HM0203", L.pol],
      [/^C\d{4}$/.test(v("cnee")), "HM0203", L.cnee],
      [!others.some((l) => l.container === v("cntr")), "HM0325", L.cntr],
    ]);
  if (failed) return failed;
  const adding = s.editLine === 0;
  const lineNo = adding
    ? Math.max(0, ...linesOf(s.books, s.voyage).map((l) => l.lineNo)) + 1
    : s.editLine;
  const refused = refusedByLock(s, "line", lineKey(s.voyage, lineNo));
  if (refused) return refused;
  const line: ManifestLine = {
    voyage: s.voyage,
    lineNo,
    container: v("cntr"),
    isoType: v("iso"),
    seal: v("seal"),
    grossKg: Number(v("wt")),
    pol: v("pol"),
    consignee: v("cnee"),
    goods: v("goods"),
    haz: v("haz"),
  };
  const nn = String(lineNo).padStart(2, "0");
  if (adding) {
    const books = { ...s.books, lines: [...s.books.lines, line] };
    return say(open(s, "HMC320", { books }), "HM0321", nn);
  }
  const books = {
    ...s.books,
    lines: s.books.lines.map((l) =>
      l.voyage === s.voyage && l.lineNo === lineNo ? line : l,
    ),
  };
  const index = linesOf(books, s.voyage).findIndex((l) => l.lineNo === lineNo);
  const page = Math.floor(index / LIST_ROWS);
  return say(open(s, "HMC310", { books, page }), "HM0322", nn);
}

const lineEntry: ScreenSpec = {
  fields: () => L_FIELDS,
  legend: () => [item("Enter", "SAVE"), HELP, EXIT, REFRESH],
  paint(s, put) {
    const mode =
      s.editLine === 0
        ? "ADD"
        : `AMEND LN ${String(s.editLine).padStart(2, "0")}`;
    put(3, 4, `VOY: ${s.voyage}   MODE: ${mode}`, "bright");
    put(15, 4, "ENTER FILES THE LINE AT ONCE.", "dim");
  },
  key(s, key) {
    if (key === "F3") {
      // Back on the page of the amended line, or the last page after adding.
      const all = linesOf(s.books, s.voyage);
      const index = all.findIndex((l) => l.lineNo === s.editLine);
      const page =
        index < 0 ? pageCount(all.length) - 1 : Math.floor(index / LIST_ROWS);
      return open(s, "HMC310", { page });
    }
    return key === "Enter" ? saveLine(s) : null;
  },
};

// HMH400 Customs holds ----------------------------------------------------------------------------

const H = {
  cntr: field("cntr", "CNTR NO", 4, 11),
  action: field("action", "ACTION", 5, 1),
  rsn: field("rsn", "RSN CD", 6, 2),
  auth: field("auth", "AUTH REF", 7, 12),
};

function holdEnter(s: MachineState): MachineState {
  const cntr = val(s, "cntr");
  const action = val(s, "action");
  if (cntr === "") return reject(s, "HM0201", H.cntr);
  const hold = holdOn(s.books, cntr);
  const ask = (act: "place" | "release", text: string): MachineState => ({
    ...s,
    message: null,
    modal: { action: act, text, answer: "" },
  });
  if (action === "") {
    return say({ ...s, shown: cntr }, hold ? "HM0402" : "HM0401");
  }
  if (action === "P") {
    if (!REASONS[val(s, "rsn")]) return reject(s, "HM0403", H.rsn);
    if (!s.books.lines.some((l) => l.container === cntr)) {
      return reject(s, "HM0404", H.cntr);
    }
    if (hold?.status === "ACTIVE") return say(s, "HM0405");
    return ask("place", "CONFIRM PLACE HOLD  Y/N");
  }
  if (action === "R") {
    if (hold?.status !== "ACTIVE") return say(s, "HM0406");
    if (val(s, "auth") === "") return reject(s, "HM0201", H.auth);
    return ask("release", "CONFIRM RELEASE HOLD  Y/N");
  }
  return reject(s, "HM0407", H.action);
}

const holds: ScreenSpec = {
  fields: () => Object.values(H),
  legend: () => [item("Enter", "ENQUIRE/ACTION"), HELP, EXIT, REFRESH],
  paint(s, put) {
    put(5, 46, "ACTION  P=PLACE  R=RELEASE", "dim");
    put(6, 46, "RSN CD  11 DOCS  23 XRAY", "dim");
    put(7, 46, "        41 VALN  57 QUAR", "dim");
    if (s.shown === "") return;
    const hold = holdOn(s.books, s.shown);
    put(10, 4, `HOLD RECORD FOR ${s.shown}`, "bright");
    if (!hold) {
      put(12, 4, "NO HOLD ON FILE");
      return;
    }
    put(12, 4, `STATUS ..... ${hold.status}`);
    put(13, 4, `RSN CD ..... ${hold.reason} ${REASONS[hold.reason] ?? ""}`);
    put(14, 4, `PLACED BY .. ${hold.placedBy}`);
    put(15, 4, `AUTH REF ... ${hold.authority}`);
  },
  key(s, key) {
    if (key === "F3") return open(s, "HMM100", { shown: "" });
    return key === "Enter" ? holdEnter(s) : null;
  },
  confirm(s, action) {
    const cntr = val(s, "cntr");
    const refused = refusedByLock(s, "hold", cntr);
    if (refused) return refused;
    const hold: Hold =
      action === "place"
        ? {
            container: cntr,
            reason: val(s, "rsn"),
            status: "ACTIVE",
            placedBy: s.operator.id.toUpperCase(),
            authority: "",
          }
        : {
            ...(holdOn(s.books, cntr) as Hold),
            status: "RELEASED",
            authority: val(s, "auth"),
          };
    const exists = s.books.holds.some((h) => h.container === cntr);
    const books = {
      ...s.books,
      holds: exists
        ? s.books.holds.map((h) => (h.container === cntr ? hold : h))
        : [...s.books.holds, hold],
    };
    const next = open(s, "HMH400", { books, shown: cntr, values: { cntr } });
    return say(next, action === "place" ? "HM0410" : "HM0411");
  },
};

// HMB500 Berth allocation -------------------------------------------------------------------------

const B = {
  voy: field("voy", "VOY NO", 4, 5),
  berth: field("berth", "BERTH", 5, 3),
  fromDt: field("fromDt", "FROM DT (DDMMYY)", 6, 6),
  fromTm: field("fromTm", "FROM TM (HHMM)", 7, 4),
  toDt: field("toDt", "TO DT (DDMMYY)", 8, 6),
  toTm: field("toTm", "TO TM (HHMM)", 9, 4),
};
const B_FIELDS = Object.values(B);

function bookingKeyed(s: MachineState): BerthBooking {
  const stamp = (dt: string, tm: string) =>
    `${parseDate(val(s, dt)) ?? ""}T${parseTime(val(s, tm)) ?? ""}`;
  return {
    berth: val(s, "berth"),
    voyage: val(s, "voy"),
    from: stamp("fromDt", "fromTm"),
    to: stamp("toDt", "toTm"),
  };
}

function validateBerth(s: MachineState): MachineState | null {
  const v = (id: string) => val(s, id);
  const basics =
    missing(s, B_FIELDS) ??
    firstFailure(s, [
      [vesselByVoyage(s.books, v("voy")) !== undefined, "HM0301", B.voy],
      [BERTHS[v("berth")] !== undefined, "HM0511", B.berth],
      [parseDate(v("fromDt")) !== null, "HM0204", B.fromDt],
      [parseTime(v("fromTm")) !== null, "HM0205", B.fromTm],
      [parseDate(v("toDt")) !== null, "HM0204", B.toDt],
      [parseTime(v("toTm")) !== null, "HM0205", B.toTm],
    ]);
  if (basics) return basics;
  const want = bookingKeyed(s);
  const loa = vesselByVoyage(s.books, want.voyage)?.loaM ?? 0;
  // Same-format stamps compare as text.
  const occupied = s.books.berths.some(
    (b) =>
      b.berth === want.berth &&
      b.voyage !== want.voyage &&
      b.from < want.to &&
      want.from < b.to,
  );
  return firstFailure(s, [
    [want.from < want.to, "HM0513", B.toDt],
    [loa <= BERTHS[want.berth], "HM0512", B.berth],
    [!occupied, "HM0514", B.berth],
  ]);
}

function commitBerth(s: MachineState): MachineState {
  const want = bookingKeyed(s);
  const refused = refusedByLock(s, "berth", want.voyage);
  if (refused) return refused;
  const berths = bookingOf(s.books, want.voyage)
    ? s.books.berths.map((b) => (b.voyage === want.voyage ? want : b))
    : [...s.books.berths, want];
  return say(open(s, "HMB500", { books: { ...s.books, berths } }), "HM0510");
}

const berth: ScreenSpec = {
  fields: () => B_FIELDS,
  legend: () => CONFIRM_LEGEND,
  paint(s, put) {
    put(4, 50, "BERTH  MAX LOA M", "dim");
    Object.entries(BERTHS).forEach(([code, max], i) => {
      put(5 + i, 50, `${code}    ${String(max).padStart(3)}`);
    });
    put(12, 4, "BERTH  VOY NO  FROM            TO", "dim");
    [...s.books.berths]
      .sort((a, b) =>
        `${a.berth}${a.from}`.localeCompare(`${b.berth}${b.from}`),
      )
      .slice(0, LIST_ROWS)
      .forEach((b, i) => {
        put(
          13 + i,
          4,
          `${b.berth}    ${b.voyage.padEnd(5)}   ${showStamp(b.from)}  ${showStamp(b.to)}`,
        );
      });
  },
  key: (s, key) => confirmKeys(s, key, validateBerth, commitBerth),
};

// HMT600 Tariff maintenance and HMA900 Administration: reachable, harmless ------------------------

const T = {
  trf: field("trf", "TRF CD", 4, 4),
  rate: field("rate", "RATE MRC", 5, 7),
  eff: field("eff", "EFF DT (DDMMYY)", 6, 6),
};

const TARIFFS = [
  "W101    WHARFAGE 20FT        148.00",
  "W102    WHARFAGE 40FT        263.50",
  "P201    PILOTAGE /100M       912.00",
  "B301    BERTH HIRE /HR        77.25",
  "R401    REEFER PLUG /DAY      54.00",
];

const tariff: ScreenSpec = {
  fields: () => Object.values(T),
  legend: () => [item("Enter", "UPDATE"), HELP, EXIT, REFRESH],
  paint(_s, put) {
    put(9, 4, "TRF CD  DESC               RATE MRC", "dim");
    TARIFFS.forEach((t, i) => {
      put(10 + i, 4, t);
    });
  },
  key(s, key) {
    if (key === "F3") return open(s, "HMM100");
    // Queued for a night run that never comes: the Books do not hold tariffs.
    return key === "Enter" ? say(open(s, "HMT600"), "HM0601") : null;
  },
};

const A = {
  opr: field("opr", "OPR ID", 4, 8),
  action: field("action", "ACTION", 5, 1),
};

const USERS = [
  "OPR3      MANIFEST DESK 3     CLERK   ACTIVE",
  "OPR7      MANIFEST DESK 7     CLERK   ACTIVE",
  "CLERK07   BERTH PLANNING 7    CLERK   ACTIVE",
  "SUPV01    DUTY SUPERVISOR     SUPV    ACTIVE",
  "AUDIT1    PORT AUDIT          READ    SUSPENDED",
];

const admin: ScreenSpec = {
  fields: () => Object.values(A),
  legend: () => [item("Enter", "ACTION"), HELP, EXIT, REFRESH],
  paint(_s, put) {
    put(5, 46, "ACTION  S=SUSPEND  U=UNLOCK", "dim");
    put(6, 46, "        X=RESET PWD", "dim");
    put(9, 4, "OPR ID    DESK                CLASS   STATUS", "dim");
    USERS.forEach((u, i) => {
      put(10 + i, 4, u);
    });
  },
  key(s, key) {
    if (key === "F3") return open(s, "HMM100");
    return key === "Enter" ? say(s, "HM0901") : null;
  },
};

// HMX990 Session timed out ------------------------------------------------------------------------

const timedOut: ScreenSpec = {
  fields: () => [],
  legend: () => [item("Enter", "SIGN ON")],
  paint(_s, put) {
    put(9, 22, "THIS SESSION WAS IDLE TOO LONG AND WAS CLOSED.", "bright");
    put(11, 22, "ANYTHING KEYED BUT NOT FILED IS LOST.");
    put(12, 22, "FILED RECORDS ARE KEPT.");
  },
  key(s, key) {
    // Every other key is swallowed: the message already says what to press.
    return key === "Enter" ? open(s, "HMS000") : s;
  },
};

export const SCREENS: Record<ScreenCode, ScreenSpec> = {
  HMS000: signOn,
  HMM100: menu,
  HMV200: arrival,
  HMV210: enquiry,
  HMC300: pickVoyage,
  HMC310: lines,
  HMC320: lineEntry,
  HMH400: holds,
  HMB500: berth,
  HMT600: tariff,
  HMA900: admin,
  HMX990: timedOut,
};
