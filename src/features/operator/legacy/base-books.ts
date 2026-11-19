import { containerNumber } from "../domain/iso6346";
import { cloneBooks } from "./books";
import type { Books, ManifestLine, Vessel } from "./types";

/**
 * What the Port Authority of Meridia has on file before any Task starts.
 * Everything is invented: the Republic of Meridia, its ports (MRKLD, MRVNT,
 * MRPSA, MRTRS, MROSK), the vessels, agents and consignees. Container
 * numbers are built with a valid ISO 6346 check digit.
 */

const vessel = (
  name: string,
  imo: string,
  callSign: string,
  flag: string,
  voyage: string,
  eta: string,
  loaM: number,
  agent: string,
): Vessel => ({ imo, name, callSign, flag, voyage, eta, loaM, agent });

const VESSELS: Vessel[] = [
  vessel(
    "MV SALTMARSH HERON",
    "9288410",
    "MRSH5",
    "MRD",
    "0377E",
    "2026-11-19T05:30",
    294,
    "AG01",
  ),
  vessel(
    "MV TARRASQUE BAY",
    "9110365",
    "MRTB9",
    "MRD",
    "0385E",
    "2026-11-18T11:20",
    158,
    "AG06",
  ),
  vessel(
    "MV NORTH LANTERN",
    "9233906",
    "VLNL3",
    "VLT",
    "0390N",
    "2026-11-20T08:00",
    199,
    "AG08",
  ),
  vessel(
    "MV GREY CORMORANT",
    "9321680",
    "MRGC6",
    "MRD",
    "0395E",
    "2026-11-23T19:10",
    176,
    "AG05",
  ),
  vessel(
    "MV HALCYON TERN",
    "9301144",
    "MRHT2",
    "MRD",
    "0398S",
    "2026-11-24T14:00",
    241,
    "AG03",
  ),
  vessel(
    "MV PELLAMAR",
    "9198473",
    "OSPM7",
    "OSK",
    "0401S",
    "2026-11-26T12:30",
    255,
    "AG02",
  ),
  vessel(
    "MV OSKA PETREL",
    "9175532",
    "OSOP8",
    "OSK",
    "0402W",
    "2026-11-21T22:15",
    172,
    "AG05",
  ),
  vessel(
    "MV KELDA STAR",
    "9350027",
    "MRKS1",
    "MRD",
    "0406N",
    "2026-11-22T09:45",
    210,
    "AG02",
  ),
  vessel(
    "MV VENTA GRACE",
    "9267791",
    "MRVG4",
    "MRD",
    "0409S",
    "2026-11-25T03:00",
    333,
    "AG04",
  ),
  vessel(
    "MV AURELINE",
    "9402218",
    "VLAU1",
    "VLT",
    "0411W",
    "2026-11-27T17:40",
    388,
    "AG01",
  ),
];

/** owner, serial, ISO type, gross kg, port of loading, consignee, goods, hazard class. */
type Row = [string, string, string, number, string, string, string, string];

function manifest(voyage: string, rows: Row[]): ManifestLine[] {
  return rows.map(
    ([owner, serial, isoType, grossKg, pol, consignee, goods, haz], i) => ({
      voyage,
      lineNo: i + 1,
      container: containerNumber(owner, serial),
      isoType,
      seal: `MS${voyage.slice(0, 4)}${String(i + 1).padStart(3, "0")}`,
      grossKg,
      pol,
      consignee,
      goods,
      haz,
    }),
  );
}

/** The long voyage: 16 lines, so its list runs to a second page. */
const HERON: Row[] = [
  [
    "MRLU",
    "204417",
    "22G1",
    18420,
    "MRKLD",
    "C0118",
    "CERAMIC FLOOR TILES",
    "",
  ],
  ["MRLU", "204633", "22G1", 17950, "MRKLD", "C0118", "CERAMIC WALL TILES", ""],
  [
    "KLDU",
    "771188",
    "45G1",
    22300,
    "MRKLD",
    "C0207",
    "FLAT PACK FURNITURE",
    "",
  ],
  ["HBRU", "512744", "22G1", 9860, "MRVNT", "C0140", "KNITWEAR IN CARTONS", ""],
  [
    "VNTU",
    "338052",
    "45R1",
    26480,
    "MRVNT",
    "C0096",
    "FROZEN HAKE FILLETS",
    "",
  ],
  ["VNTU", "338067", "45R1", 26110, "MRVNT", "C0096", "FROZEN SQUID TUBES", ""],
  [
    "KLDU",
    "771305",
    "45G1",
    24110,
    "MRVNT",
    "C0231",
    "TINNED SARDINES IN OIL",
    "",
  ],
  ["OSKU", "460921", "22T6", 23750, "MROSK", "C0312", "LUBRICATING OIL", "9"],
  [
    "HBRU",
    "512960",
    "22G1",
    21840,
    "MRKLD",
    "C0140",
    "COTTON YARN ON CONES",
    "",
  ],
  ["MRDU", "615702", "42G1", 14230, "MRKLD", "C0255", "BICYCLE FRAMES", ""],
  ["MRDU", "615719", "42G1", 13980, "MRKLD", "C0255", "BICYCLE WHEELS", ""],
  // Keyed twice by mistake: the same box as line 7.
  [
    "KLDU",
    "771305",
    "45G1",
    24110,
    "MRVNT",
    "C0231",
    "TINNED SARDINES IN OIL",
    "",
  ],
  ["TRSU", "129446", "22G1", 19340, "MRTRS", "C0184", "GLASS JARS EMPTY", ""],
  [
    "TRSU",
    "129583",
    "22G1",
    20015,
    "MRTRS",
    "C0184",
    "GLASS BOTTLES EMPTY",
    "",
  ],
  ["PSAU", "804370", "22P1", 27600, "MRTRS", "C0339", "STEEL COIL", ""],
  ["OSKU", "461008", "22T6", 22890, "MROSK", "C0312", "PAINT THINNER", "3"],
];

const TERN: Row[] = [
  ["MRDU", "530118", "22G1", 16200, "MRPSA", "C0127", "OLIVE OIL IN TINS", ""],
  [
    "MRDU",
    "530264",
    "22G1",
    15870,
    "MRPSA",
    "C0127",
    "TABLE OLIVES IN BRINE",
    "",
  ],
  ["HBRU", "698015", "45G1", 21430, "MRPSA", "C0203", "PAPER REELS", ""],
  ["TRSU", "330418", "45G1", 19960, "MRTRS", "C0274", "MACHINE TOOLS USED", ""],
  ["TRSU", "330592", "22G1", 12480, "MRTRS", "C0274", "HAND TOOLS", ""],
  ["VNTU", "402771", "45R1", 25300, "MRVNT", "C0096", "CHILLED CITRUS", ""],
  ["KLDU", "845620", "22G1", 17640, "MRKLD", "C0161", "ROOF SLATES", ""],
  ["OSKU", "477139", "22T6", 24050, "MROSK", "C0312", "ETHANOL DENATURED", "3"],
  ["PSAU", "811906", "42G1", 11320, "MRPSA", "C0288", "PLASTIC CRATES", ""],
];

const PETREL: Row[] = [
  ["OSKU", "455210", "22G1", 20480, "MROSK", "C0145", "SEA SALT IN BAGS", ""],
  ["OSKU", "455388", "22G1", 20510, "MROSK", "C0145", "SEA SALT IN BAGS", ""],
  ["MRLU", "290746", "45G1", 18730, "MROSK", "C0219", "TIMBER PLANED", ""],
  ["MRLU", "290853", "45G1", 18910, "MROSK", "C0219", "TIMBER SAWN", ""],
  ["HBRU", "577402", "22R1", 21260, "MROSK", "C0301", "SEED POTATOES", ""],
  ["KLDU", "802915", "22G1", 8740, "MRKLD", "C0166", "LAMP SHADES", ""],
  ["TRSU", "188034", "22G1", 23120, "MRTRS", "C0190", "FERTILISER NPK", "5.1"],
  ["PSAU", "790551", "42G1", 15600, "MRPSA", "C0288", "GARDEN FURNITURE", ""],
];

const KELDA: Row[] = [
  ["KLDU", "860133", "45G1", 22840, "MRKLD", "C0207", "KITCHEN UNITS", ""],
  [
    "KLDU",
    "860247",
    "45G1",
    21990,
    "MRKLD",
    "C0207",
    "WARDROBES FLAT PACK",
    "",
  ],
  ["MRDU", "644905", "22G1", 13370, "MRKLD", "C0233", "PRINTED BOOKS", ""],
  ["VNTU", "371680", "22G1", 19450, "MRVNT", "C0152", "WINE IN BOTTLES", ""],
  ["VNTU", "371826", "22G1", 19280, "MRVNT", "C0152", "WINE IN BOTTLES", ""],
  ["HBRU", "601579", "22G1", 10420, "MRVNT", "C0140", "WOOLLEN BLANKETS", ""],
  ["OSKU", "490362", "22T6", 23310, "MROSK", "C0312", "BASE OIL", "9"],
];

const VENTA: Row[] = [
  ["PSAU", "822045", "45G1", 24700, "MRPSA", "C0339", "ALUMINIUM INGOTS", ""],
  ["PSAU", "822193", "45G1", 24650, "MRPSA", "C0339", "ALUMINIUM INGOTS", ""],
  ["MRLU", "315508", "22G1", 16980, "MRPSA", "C0118", "SANITARY WARE", ""],
  ["TRSU", "207761", "22G1", 14890, "MRTRS", "C0184", "CROCKERY", ""],
  ["VNTU", "429934", "45R1", 26020, "MRVNT", "C0096", "FROZEN PRAWNS", ""],
];

const LINES: ManifestLine[] = [
  ...manifest("0377E", HERON),
  ...manifest("0398S", TERN),
  ...manifest("0402W", PETREL),
  ...manifest("0406N", KELDA),
  ...manifest("0409S", VENTA),
];

export const BASE_BOOKS: Books = {
  vessels: VESSELS,
  lines: LINES,
  holds: [
    {
      container: containerNumber("KLDU", "771188"),
      reason: "23",
      status: "RELEASED",
      placedBy: "OPR3",
      authority: "RO-2611-0431",
    },
    {
      container: containerNumber("TRSU", "330418"),
      reason: "11",
      status: "ACTIVE",
      placedBy: "OPR3",
      authority: "",
    },
    {
      container: containerNumber("HBRU", "577402"),
      reason: "57",
      status: "ACTIVE",
      placedBy: "OPR3",
      authority: "",
    },
    {
      container: containerNumber("KLDU", "860247"),
      reason: "41",
      status: "RELEASED",
      placedBy: "OPR7",
      authority: "RO-2611-0419",
    },
  ],
  berths: [
    {
      berth: "B01",
      voyage: "0385E",
      from: "2026-11-18T12:00",
      to: "2026-11-19T18:00",
    },
    {
      berth: "B04",
      voyage: "0377E",
      from: "2026-11-19T06:00",
      to: "2026-11-21T20:00",
    },
    {
      berth: "B01",
      voyage: "0402W",
      from: "2026-11-21T23:00",
      to: "2026-11-23T06:00",
    },
    {
      berth: "B02",
      voyage: "0406N",
      from: "2026-11-22T10:00",
      to: "2026-11-24T16:00",
    },
    {
      berth: "B05",
      voyage: "0409S",
      from: "2026-11-25T04:00",
      to: "2026-11-27T12:00",
    },
    {
      berth: "B03",
      voyage: "0401S",
      from: "2026-11-26T13:00",
      to: "2026-11-28T09:00",
    },
    {
      berth: "B06",
      voyage: "0411W",
      from: "2026-11-27T18:00",
      to: "2026-11-30T06:00",
    },
  ],
};

/** A fresh copy of the starting Books for a Fixture. */
export function baseBooks(): Books {
  return cloneBooks(BASE_BOOKS);
}
