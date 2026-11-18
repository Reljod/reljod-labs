import { baseBooks } from "../legacy/base-books";
import type { Fixture } from "../legacy/types";
import type { ActionKey, ScreenAction, ScriptTurn } from "./actions";
import { containerNumber, spacedContainer } from "./iso6346";
import type { Expectation, SampleTask } from "./task";

/**
 * The three sample Tasks. Each starts from the port's base Books, says what
 * is wanted in a supervisor's words, lists exactly the changes a correct Run
 * makes, and carries a Script that makes them (proved in `tasks.test.ts`).
 */

const OPERATOR = { id: "OPR7", password: "MERIDIA1" };
const SIGN_ON = `Sign on as ${OPERATOR.id}, password ${OPERATOR.password}.`;

function fixture(
  id: string,
  portTime: string,
  locks: Fixture["locks"] = [],
): Fixture {
  return {
    id,
    books: baseBooks(),
    portTime,
    operator: OPERATOR,
    idleSeconds: 240,
    locks,
  };
}

// Script shorthand ---------------------------------------------------------------------------

const type = (text: string): ScreenAction => ({ type: "type", text });
const press = (...keys: ActionKey[]): ScreenAction => ({ type: "key", keys });
const wait = (ms: number): ScreenAction => ({ type: "wait", ms });
const turn = (intent: string, ...actions: ScreenAction[]): ScriptTurn => ({
  intent,
  actions,
});

/** Keys a form top to bottom: each value, then Tab to the next field. */
function form(...values: string[]): ScreenAction[] {
  return values.flatMap((value, i) => [
    ...(value === "" ? [] : [type(value)]),
    ...(i < values.length - 1 ? [press("Tab")] : []),
  ]);
}

const signOn = turn(
  "Sign on",
  ...form(OPERATOR.id, OPERATOR.password),
  press("Enter"),
);
const signOff = turn("Sign off", press("F3"));

// 1. Arrival of MV Corvina ---------------------------------------------------------------------

const CORVINA = {
  name: "MV CORVINA",
  imo: "9412057",
  callSign: "MRCV7",
  flag: "MRD",
  voyage: "0412N",
  eta: "2026-12-04T06:30",
  loaM: 228,
  agent: "AG07",
};

const XRAY_CONTAINER = containerNumber("MRDU", "482113");

const CORVINA_MANIFEST = `# SPECIMEN - Port Authority of Meridia - cargo manifest
# Fictional data for a demonstration. Not a real vessel, cargo or consignee.
vessel,MV CORVINA
voyage,0412N
container,iso_type,seal,gross_kg,pol,consignee,haz,goods
MRDU 482113 1,22G1,MS0412001,18250,MRKLD,C0412,,CANNED TOMATOES
MRDU5077261,22G1,MS0412002,9840,MRKLD,C0412,,OLIVE OIL IN DRUMS
KLDU1188345,45G1,MS0412003,24600,MRKLD,C0207,,"MACHINE PARTS, AGRICULTURAL, CRATED"
HBRU6400910,45R1,MS0412004,27310,MRVNT,C0096,,FROZEN MACKEREL
VNTU2755604,22T6,MS0412005,23480,MRVNT,C0312,3,SOLVENT NAPHTHA
MRLU9033177,42G1,MS0412006,7625,MRPSA,C0288,,WICKER BASKETS
`;

/** The six lines as a clerk keys them: no spaces in the container, goods cut to fit. */
const CORVINA_LINES = [
  {
    container: XRAY_CONTAINER,
    isoType: "22G1",
    seal: "MS0412001",
    grossKg: 18250,
    pol: "MRKLD",
    consignee: "C0412",
    goods: "CANNED TOMATOES",
    haz: "",
  },
  {
    container: "MRDU5077261",
    isoType: "22G1",
    seal: "MS0412002",
    grossKg: 9840,
    pol: "MRKLD",
    consignee: "C0412",
    goods: "OLIVE OIL IN DRUMS",
    haz: "",
  },
  // 35 characters in the file; the field keeps 24, so the clerk shortens it.
  {
    container: "KLDU1188345",
    isoType: "45G1",
    seal: "MS0412003",
    grossKg: 24600,
    pol: "MRKLD",
    consignee: "C0207",
    goods: "AGRICULTURAL MACH PARTS",
    haz: "",
  },
  {
    container: "HBRU6400910",
    isoType: "45R1",
    seal: "MS0412004",
    grossKg: 27310,
    pol: "MRVNT",
    consignee: "C0096",
    goods: "FROZEN MACKEREL",
    haz: "",
  },
  {
    container: "VNTU2755604",
    isoType: "22T6",
    seal: "MS0412005",
    grossKg: 23480,
    pol: "MRVNT",
    consignee: "C0312",
    goods: "SOLVENT NAPHTHA",
    haz: "3",
  },
  {
    container: "MRLU9033177",
    isoType: "42G1",
    seal: "MS0412006",
    grossKg: 7625,
    pol: "MRPSA",
    consignee: "C0288",
    goods: "WICKER BASKETS",
    haz: "",
  },
];
/** The line whose goods the Operator has to shorten in its own words. */
const SHORTENED = "KLDU1188345";

const arrivalCorvina: SampleTask = {
  id: "arrival-corvina",
  title: "Arrival of MV Corvina",
  summary:
    "Register a vessel, key its six-line manifest and hold one container for X-ray.",
  brief: `${SIGN_ON} MV Corvina is due on voyage 0412N: register her arrival. She is IMO 9412057, call sign MRCV7, flag MRD, 228 metres long, agent AG07, and she is expected on 4 December 2026 at half past six in the morning. Then key her cargo manifest from the attached file, corvina-0412n.csv: all six lines, exactly as on the paper. Customs wants container ${spacedContainer(XRAY_CONTAINER)} X-rayed, so put a customs hold on it for X-ray. Sign off when you are done.`,
  manifest: {
    name: "corvina-0412n.csv",
    href: "/operator/samples/corvina-0412n.csv",
    text: CORVINA_MANIFEST,
  },
  fixture: fixture("arrival-corvina", "2026-11-23T08:10"),
  expected: [
    {
      label: "MV Corvina registered, due 4 December 2026 at 06:30",
      op: "add",
      record: "vessel",
      where: { imo: CORVINA.imo },
      values: CORVINA,
    },
    ...CORVINA_LINES.map((line, i): Expectation => {
      const { container, goods, ...rest } = line;
      return {
        label: `Manifest line ${i + 1}: ${spacedContainer(container)}`,
        op: "add",
        record: "line",
        where: { voyage: CORVINA.voyage, container },
        values: container === SHORTENED ? rest : { ...rest, goods },
      };
    }),
    {
      label: `Hold placed on ${spacedContainer(XRAY_CONTAINER)} (reason 23, X-ray)`,
      op: "add",
      record: "hold",
      where: { container: XRAY_CONTAINER },
      values: { reason: "23", status: "ACTIVE" },
    },
  ],
  traps: [
    "Dates are keyed DDMMYY",
    "Nothing is filed until F10",
    "Fields cut what does not fit, silently",
    "A container written with spaces",
  ],
  needsApproval: false,
  script: [
    signOn,
    turn("Open vessel arrivals", type("1"), press("Enter")),
    turn(
      "Key the arrival of MV Corvina, the date as day, month, year",
      ...form(
        CORVINA.name,
        CORVINA.imo,
        CORVINA.callSign,
        CORVINA.flag,
        CORVINA.voyage,
        "041226",
        "0630",
        String(CORVINA.loaM),
        CORVINA.agent,
      ),
      press("Enter"),
    ),
    turn("Confirm the arrival so it is filed", press("F10")),
    turn("Go back to the menu", press("F3")),
    turn("Open the cargo manifest", type("2"), press("Enter")),
    turn("Open voyage 0412N", type(CORVINA.voyage), press("Enter")),
    turn("Start a new manifest line", press("F6")),
    ...CORVINA_LINES.map((line, i) =>
      turn(
        `Key line ${i + 1} of the manifest`,
        ...form(
          line.container,
          line.isoType,
          line.seal,
          String(line.grossKg),
          line.pol,
          line.consignee,
          line.goods,
          line.haz,
        ),
        press("Enter"),
      ),
    ),
    turn("Go back to the list and count the six lines", press("F3")),
    turn("Leave the manifest", press("F3", "F3")),
    turn("Open customs holds", type("3"), press("Enter")),
    turn(
      "Key a hold on the container, reason 23 for X-ray",
      ...form(XRAY_CONTAINER, "P", "23"),
      press("Enter"),
    ),
    turn("Confirm the hold", type("Y"), press("Enter")),
    turn("Go back to the menu", press("F3")),
    signOff,
  ],
};

// 2. Release a hold, allocate a berth ----------------------------------------------------------

const RELEASE_CONTAINER = containerNumber("TRSU", "330418");
const RELEASE_ORDER = "RO-2611-0457";
const TERN_VOYAGE = "0398S";

const releaseAndBerth: SampleTask = {
  id: "release-and-berth",
  title: "Release a hold, book a berth",
  summary:
    "Release a customs hold on a release order, then book berth B03 for MV Halcyon Tern.",
  brief: `${SIGN_ON} Customs has issued release order ${RELEASE_ORDER} for container ${spacedContainer(RELEASE_CONTAINER)}: release the hold on it. Then give MV Halcyon Tern berth B03 from 24 November 2026 at 15:00 to 26 November 2026 at 09:00. Sign off when you are done.`,
  manifest: null,
  fixture: fixture("release-and-berth", "2026-11-23T09:40", [
    { record: "berth", key: TERN_VOYAGE, clerk: "CLERK07", retries: 2 },
  ]),
  expected: [
    {
      label: `Hold on ${spacedContainer(RELEASE_CONTAINER)} released on ${RELEASE_ORDER}`,
      op: "update",
      record: "hold",
      where: { container: RELEASE_CONTAINER },
      values: { status: "RELEASED", authority: RELEASE_ORDER },
    },
    {
      label:
        "MV Halcyon Tern on berth B03, 24 November 15:00 to 26 November 09:00",
      op: "add",
      record: "berth",
      where: { voyage: TERN_VOYAGE },
      values: {
        berth: "B03",
        from: "2026-11-24T15:00",
        to: "2026-11-26T09:00",
      },
    },
  ],
  traps: [
    "Releasing a hold needs a person",
    "The berth record is in use by another clerk",
    "Nothing is filed until F10",
    "Dates are keyed DDMMYY",
  ],
  needsApproval: true,
  script: [
    signOn,
    turn("Open the vessel list", type("5"), press("Enter")),
    turn("Note MV Halcyon Tern's voyage number, then go back", press("F3")),
    turn("Open customs holds", type("3"), press("Enter")),
    turn(
      "Look up the hold on the container",
      type(RELEASE_CONTAINER),
      press("Enter"),
    ),
    turn(
      "Key the release with the release order as its authority",
      press("Tab"),
      type("R"),
      press("Tab", "Tab"),
      type(RELEASE_ORDER),
      press("Enter"),
    ),
    turn("Confirm the release", type("Y"), press("Enter")),
    turn("Go back to the menu", press("F3")),
    turn("Open berth allocation", type("4"), press("Enter")),
    turn(
      "Key berth B03 for the voyage, from 24 November 15:00 to 26 November 09:00",
      ...form(TERN_VOYAGE, "B03", "241126", "1500", "261126", "0900"),
      press("Enter"),
    ),
    turn("Confirm the booking so it is filed", press("F10")),
    turn(
      "The record is in use: wait, then confirm again",
      wait(1500),
      press("F10"),
    ),
    turn(
      "Still in use: wait, then confirm once more",
      wait(1500),
      press("F10"),
    ),
    turn("Go back to the menu", press("F3")),
    signOff,
  ],
};

// 3. Correct a manifest ------------------------------------------------------------------------

const HERON_VOYAGE = "0377E";
const RIGHT_WEIGHT = 12840;

const manifestCorrection: SampleTask = {
  id: "manifest-correction",
  title: "Correct a manifest",
  summary:
    "Delete a line keyed twice and put right one gross weight on a 16-line manifest.",
  brief: `${SIGN_ON} On voyage ${HERON_VOYAGE} (MV Saltmarsh Heron), line 12 is a duplicate keyed by mistake: delete it. And the gross weight on line 9 was keyed wrong: it should be ${RIGHT_WEIGHT} kg. Change nothing else on that line. Sign off when you are done.`,
  manifest: null,
  fixture: fixture("manifest-correction", "2026-11-19T13:25"),
  expected: [
    {
      label: "Line 9 gross weight corrected to 12840 kg",
      op: "update",
      record: "line",
      where: { voyage: HERON_VOYAGE, lineNo: 9 },
      values: { grossKg: RIGHT_WEIGHT },
    },
    {
      label: "Line 12 (the duplicate) deleted",
      op: "delete",
      record: "line",
      where: { voyage: HERON_VOYAGE, lineNo: 12 },
    },
  ],
  traps: [
    "Lines 9 and 12 are on the second page",
    "Deleting a line needs a person",
    "Only the weight may change",
  ],
  needsApproval: true,
  script: [
    signOn,
    turn("Open the cargo manifest", type("2"), press("Enter")),
    turn("Open voyage 0377E", type(HERON_VOYAGE), press("Enter")),
    turn("Turn to the second page, where lines 9 to 16 are", press("F8")),
    turn("Ask to delete a line", press("F4")),
    turn("Name line 12, the duplicate", type("12"), press("Enter")),
    turn("Confirm the delete", type("Y"), press("Enter")),
    turn("Open line 9 to amend it", type("09"), press("Enter")),
    turn(
      "Move to the gross weight, empty it and key 12840",
      press("Tab", "Tab", "Tab", "Delete"),
      type(String(RIGHT_WEIGHT)),
    ),
    turn("File the corrected line", press("Enter")),
    turn("Read the list back: line 9 shows 12840, line 12 is gone", wait(500)),
    turn("Leave the manifest", press("F3", "F3")),
    signOff,
  ],
};

export const SAMPLE_TASKS: SampleTask[] = [
  arrivalCorvina,
  releaseAndBerth,
  manifestCorrection,
];

export function sampleTask(id: string): SampleTask | undefined {
  return SAMPLE_TASKS.find((task) => task.id === id);
}
