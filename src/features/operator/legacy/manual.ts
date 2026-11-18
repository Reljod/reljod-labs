import type { ScreenCode } from "./types";

/**
 * The clerk's desk manual for HARBOURMASTER: the F1 help of every Screen and
 * the Operator's Skill text. It must stay true to `screens.ts`. Each entry is
 * at most 19 lines of at most 76 characters, so it fits the help overlay.
 */

/** Every message HARBOURMASTER can put on line 23. `{}` is filled in. */
export const MESSAGE_TABLE = {
  HM0001: {
    text: "SIGN ON REJECTED",
    error: true,
    meaning: "Wrong OPR ID or PWD. Both fields are cleared; key them again.",
  },
  HM0002: {
    text: "KEY NOT VALID HERE",
    error: true,
    meaning:
      "That key does nothing on this Screen. Read the legend on the bottom line.",
  },
  HM0003: {
    text: "SIGNED ON",
    error: false,
    meaning: "Sign on accepted; the main menu is open.",
  },
  HM0005: {
    text: "SIGNED OFF",
    error: false,
    meaning: "The session is closed; the sign-on Screen is open.",
  },
  HM0007: {
    text: "TOP OF LIST",
    error: false,
    meaning: "F7 on the first page: there is no earlier page.",
  },
  HM0008: {
    text: "END OF LIST",
    error: false,
    meaning: "F8 on the last page: there is no later page.",
  },
  HM0009: {
    text: "CANCELLED",
    error: false,
    meaning:
      "A confirm box was answered N, or a delete prompt was cancelled. Nothing was filed.",
  },
  HM0010: {
    text: "ANSWER Y OR N",
    error: true,
    meaning: "A confirm box takes only Y or N before Enter.",
  },
  HM0101: {
    text: "INVALID OPTION",
    error: true,
    meaning: "The main menu has options 1, 2, 3, 4, 5, 8 and 9 only.",
  },
  HM0201: {
    text: "FIELD REQUIRED - {}",
    error: true,
    meaning: "The named field is empty. The cursor is on it.",
  },
  HM0202: {
    text: "INVALID NUMBER - {}",
    error: true,
    meaning:
      "The named field takes digits only, above zero (IMO NO takes exactly 7).",
  },
  HM0203: {
    text: "INVALID CODE - {}",
    error: true,
    meaning:
      "The named field is not in its format: FLAG 3 letters, AGENT AGnn, ISO TYPE 4 letters or digits, POL 5 letters, CNEE CD Cnnnn.",
  },
  HM0204: {
    text: "INVALID DATE - {}",
    error: true,
    meaning:
      "The named field is not a calendar date keyed DDMMYY (six digits, no separators).",
  },
  HM0205: {
    text: "INVALID TIME - {}",
    error: true,
    meaning: "The named field is not a 24-hour time keyed HHMM (four digits).",
  },
  HM0206: {
    text: "DUPLICATE IMO NO",
    error: true,
    meaning: "A vessel with this IMO NO is already registered.",
  },
  HM0207: {
    text: "DUPLICATE VOY NO",
    error: true,
    meaning: "A vessel with this VOY NO is already registered.",
  },
  HM0210: {
    text: "PRESS F10 TO CONFIRM, F12 TO CANCEL",
    error: false,
    meaning:
      "The form passed validation and is protected. Nothing is filed until F10; F12 unlocks the fields again.",
  },
  HM0211: {
    text: "VESSEL REGISTERED",
    error: false,
    meaning: "The arrival is filed and the form is cleared.",
  },
  HM0212: {
    text: "FIELDS PROTECTED - F10 OR F12",
    error: true,
    meaning:
      "Typing while a confirm is pending. Press F10 to file or F12 to edit again.",
  },
  HM0213: {
    text: "CONFIRM CANCELLED",
    error: false,
    meaning:
      "F12 withdrew the pending confirm; the form is still filled and can be edited.",
  },
  HM0214: {
    text: "NOTHING TO CONFIRM - PRESS ENTER FIRST",
    error: true,
    meaning: "F10 before the form was validated with Enter.",
  },
  HM0301: {
    text: "VOYAGE NOT ON FILE",
    error: true,
    meaning: "No registered vessel has this VOY NO.",
  },
  HM0311: {
    text: "LINE NOT ON FILE",
    error: true,
    meaning:
      "The voyage has no line with that number (deleted lines leave a gap).",
  },
  HM0312: {
    text: "LINE {} DELETED",
    error: false,
    meaning: "The line is removed. The other lines keep their numbers.",
  },
  HM0313: {
    text: "KEY LINE NO TO DELETE, F12 TO CANCEL",
    error: false,
    meaning:
      "F4 turned the prompt into DEL LN. Key the line number and Enter, or F12 to go back to SEL LN.",
  },
  HM0321: {
    text: "LINE {} ADDED",
    error: false,
    meaning:
      "The line is filed under that number and the form is cleared for the next line.",
  },
  HM0322: {
    text: "LINE {} AMENDED",
    error: false,
    meaning: "The changed line is filed; the list of lines is open again.",
  },
  HM0325: {
    text: "DUPLICATE CNTR",
    error: true,
    meaning: "Another line of this voyage already carries this CNTR NO.",
  },
  HM0401: {
    text: "NO HOLD ON FILE",
    error: false,
    meaning: "The container has never had a customs hold.",
  },
  HM0402: {
    text: "HOLD ON FILE",
    error: false,
    meaning: "The hold record for the container is shown below the form.",
  },
  HM0403: {
    text: "INVALID RSN CD",
    error: true,
    meaning: "Placing a hold needs RSN CD 11, 23, 41 or 57.",
  },
  HM0404: {
    text: "CNTR NOT ON MANIFEST",
    error: true,
    meaning:
      "A hold can be placed only on a container keyed on some manifest, character for character.",
  },
  HM0405: {
    text: "HOLD ALREADY ACTIVE",
    error: true,
    meaning: "The container already has an ACTIVE hold.",
  },
  HM0406: {
    text: "NO ACTIVE HOLD",
    error: true,
    meaning: "Release needs an ACTIVE hold on the container.",
  },
  HM0407: {
    text: "INVALID ACTION",
    error: true,
    meaning: "ACTION is P (place), R (release) or empty (enquire).",
  },
  HM0410: {
    text: "HOLD PLACED",
    error: false,
    meaning: "The hold is filed as ACTIVE under the signed-on operator.",
  },
  HM0411: {
    text: "HOLD RELEASED",
    error: false,
    meaning: "The hold is filed as RELEASED with the AUTH REF keyed.",
  },
  HM0417: {
    text: "RECORD IN USE BY {} - RETRY",
    error: true,
    meaning:
      "Another clerk has the record open. Nothing was filed and the form is kept: press the same key again (F10, or Enter where Enter files) until it goes through.",
  },
  HM0510: {
    text: "BERTH ALLOCATED",
    error: false,
    meaning: "The booking is filed and the form is cleared.",
  },
  HM0511: {
    text: "INVALID BERTH",
    error: true,
    meaning: "BERTH is B01 to B06.",
  },
  HM0512: {
    text: "LOA EXCEEDS BERTH",
    error: true,
    meaning: "The vessel is longer than the berth's MAX LOA M.",
  },
  HM0513: {
    text: "INVALID PERIOD",
    error: true,
    meaning: "TO must be later than FROM.",
  },
  HM0514: {
    text: "BERTH OCCUPIED",
    error: true,
    meaning: "Another voyage is booked on that berth in that period.",
  },
  HM0601: {
    text: "TARIFF UPDATE QUEUED FOR NIGHT RUN",
    error: false,
    meaning:
      "The tariff change is queued. Clerks have no business on this Screen.",
  },
  HM0901: {
    text: "NOT AUTHORISED - SUPERVISOR ONLY",
    error: true,
    meaning: "Administration actions are refused for a clerk.",
  },
  HM0990: {
    text: "SESSION TIMED OUT - PRESS ENTER TO SIGN ON",
    error: true,
    meaning:
      "The session was idle too long. Anything keyed but not filed is lost; filed records are kept. Enter opens the sign-on Screen.",
  },
} as const satisfies Record<
  string,
  { text: string; error: boolean; meaning: string }
>;

export type MessageCode = keyof typeof MESSAGE_TABLE;

/** Message code -> what it means and what to do. */
export const MESSAGES: Record<string, string> = Object.fromEntries(
  Object.entries(MESSAGE_TABLE).map(([code, m]) => [
    code,
    `${m.text}: ${m.meaning}`,
  ]),
);

/** The keys that mean the same on every Screen. */
export const KEY_LEGEND = `GLOBAL KEYS
Enter      Send the form (what that does is on the legend, bottom line).
Tab        Next field. Shift+Tab (or Up): previous field. Down: next field.
Backspace  Delete the last character of the field. Delete: empty the field.
Home       First field of the Screen.
F1         Help for the Screen; any key closes it.
F3         Back one Screen (on the main menu: sign off). Unfiled input is lost.
F5         Refresh: clears the message line.
F7 / F8    Previous / next page of a list (PageUp / PageDown do the same).
F10        File a form that Enter has validated (HMV200, HMB500).
F12        Cancel a pending confirm, a confirm box or a delete prompt.
Fields are fixed width and upper case. Characters typed past the end of a
field are dropped without a message, and the cursor does not move on: press
Tab. The cursor cannot move inside a field. A click on a field puts the
cursor there; a click on a legend item or a menu option presses it.
A confirm box takes Y or N then Enter, or a click on [ Y ] or [ N ].
Line 23 shows the last message (HMnnnn); line 24 the keys of the Screen.
A session idle for too long is closed and what was not filed is lost.`;

export const MANUAL: Record<ScreenCode, string> = {
  HMS000: `HMS000 SIGN ON
OPR ID   8  Your operator id.
PWD      8  Your password; shown as asterisks.
Key OPR ID, Tab, PWD, Enter. The main menu opens (HM0003).
HM0001 SIGN ON REJECTED: wrong id or password; both fields are cleared.
F3 does nothing here.`,
  HMM100: `HMM100 MAIN MENU
SELECT OPTION  1  Key one digit, then Enter (or click the option).
1 VESSEL ARRIVALS   HMV200  Register a vessel's arrival.
2 CARGO MANIFEST    HMC300  Key, amend or delete manifest lines.
3 CUSTOMS HOLDS     HMH400  Enquire, place or release a hold.
4 BERTH ALLOCATION  HMB500  Book a berth for a voyage.
5 VESSEL ENQUIRY    HMV210  List of registered vessels (read only).
8 TARIFF MAINT      HMT600  Not for clerks.
9 ADMINISTRATION    HMA900  Not for clerks.
F3 signs off (HM0005) and opens HMS000.
HM0101 INVALID OPTION: not one of the digits above.`,
  HMV200: `HMV200 VESSEL ARRIVAL REGISTRATION
VSL NM           20  Vessel name, e.g. MV CORVINA.
IMO NO            7  Exactly 7 digits. Must not be on file (HM0206).
CALL SGN          7  Radio call sign.
FLAG              3  3 letters.
VOY NO            5  Voyage number, e.g. 0412N. Not yet on file (HM0207).
ETA DT (DDMMYY)   6  Day, month, 2-digit year, no separators: 041226.
ETA TM (HHMM)     4  24-hour clock, no separator: 0630.
LOA M             3  Length overall in metres, digits.
AGENT             4  Agent code AGnn, e.g. AG07.
All fields are required. Enter only VALIDATES: HM0210 PRESS F10 TO CONFIRM
and the fields are protected. NOTHING IS FILED UNTIL F10 (HM0211 VESSEL
REGISTERED, form cleared). F12 cancels the confirm so you can edit.
F3 leaves and loses the form.
The date is taken as keyed: 261204 is read as 26 December 2004 and is
accepted. A date with separators or a 4-digit year does not fit 6 cells.
Errors name the field: HM0201 FIELD REQUIRED, HM0202 INVALID NUMBER,
HM0203 INVALID CODE, HM0204 INVALID DATE, HM0205 INVALID TIME.`,
  HMV210: `HMV210 VESSEL ENQUIRY
Read only. Every registered vessel, 8 to a page, in the order registered:
VSL NM, IMO NO, CALL SG, FLG, VOY (voyage number), ETA DT/TM (DD.MM.YY
HH:MM), LOA (metres), AGNT.
PAGE n OF m is top right. F8 next page, F7 previous page.
HM0007 TOP OF LIST / HM0008 END OF LIST: no page that way.
F3 back to the main menu.`,
  HMC300: `HMC300 CARGO MANIFEST: VOYAGE
VOY NO  5  The voyage whose manifest you want, then Enter.
The list of its lines (HMC310) opens.
HM0301 VOYAGE NOT ON FILE: no registered vessel has that voyage. Register
the arrival first (HMV200) or check the number in HMV210.
F3 back to the main menu.`,
  HMC310: `HMC310 CARGO MANIFEST: LINES
The lines of one voyage, 8 to a page: LN (line number), CNTR NO, TYPE,
GR WT (kg), CNEE, HAZ, GOODS. LINES: n and PAGE n OF m are on line 4.
F8 next page, F7 previous page. A line on a later page is not shown until
you page to it.
F6     Add a line: opens HMC320 empty.
SEL LN 2  Key a line number, Enter: opens HMC320 filled, to amend it.
F4     Delete: the prompt becomes DEL LN (HM0313). Key the line number,
       Enter. A box asks CONFIRM DELETE LINE nn  Y/N: key Y, Enter (or
       click [ Y ]) to delete (HM0312); N cancels (HM0009).
       F12 leaves DEL LN without deleting.
A deleted line leaves a gap: the other lines keep their numbers.
HM0311 LINE NOT ON FILE: no such line number on this voyage.
F3 back to HMC300.`,
  HMC320: `HMC320 CARGO MANIFEST: LINE ENTRY
CNTR NO   11  Container number with NO spaces or dashes: MRDU4821131.
ISO TYPE   4  Size/type code, e.g. 22G1, 45R1.
SEAL NO   10  Seal number.
GR WT KG   5  Gross weight in kg, digits only, at most 99999.
POL        5  Port of loading, 5 letters, e.g. MRKLD.
CNEE CD    5  Consignee code Cnnnn, e.g. C0412.
GOODS     24  Description; shorten it yourself to 24 characters.
HAZ CL     3  IMDG class, e.g. 3 or 5.1. Optional.
Enter FILES THE LINE AT ONCE; there is no confirm step.
MODE ADD: HM0321 LINE nn ADDED, form cleared for the next line.
MODE AMEND LN nn: fields show the line. Tab to a field, Delete empties it,
key the new value, Enter: HM0322 LINE nn AMENDED and back to HMC310.
Characters past a field's width are dropped silently: MRDU 482113 1 is
filed as "MRDU 482113", a 6-digit weight loses its last digit. The check
digit is NOT verified. Read the line back before Enter.
HM0325 DUPLICATE CNTR: the voyage already has this container.
HM0201 / HM0202 / HM0203 name the field at fault.
F3 back to HMC310 without filing.`,
  HMH400: `HMH400 CUSTOMS HOLDS
CNTR NO   11  Container number, no spaces.
ACTION     1  Empty = enquire. P = place a hold. R = release a hold.
RSN CD     2  For P: 11 DOCS, 23 XRAY, 41 VALN, 57 QUAR.
AUTH REF  12  For R: the release order reference, e.g. RO-2611-0457.
Enquire: key CNTR NO, Enter. HM0402 HOLD ON FILE shows STATUS, RSN CD,
PLACED BY and AUTH REF; HM0401 NO HOLD ON FILE otherwise.
Place: CNTR NO, ACTION P, RSN CD, Enter. Release: CNTR NO, ACTION R,
AUTH REF, Enter. A box asks CONFIRM PLACE HOLD  Y/N or CONFIRM RELEASE
HOLD  Y/N: key Y, Enter (or click [ Y ]). N cancels (HM0009).
HM0410 HOLD PLACED / HM0411 HOLD RELEASED: filed, record shown.
HM0403 INVALID RSN CD. HM0404 CNTR NOT ON MANIFEST: the container must be
keyed on a manifest exactly as typed here. HM0405 HOLD ALREADY ACTIVE.
HM0406 NO ACTIVE HOLD: nothing to release. HM0407 INVALID ACTION.
F3 back to the main menu.`,
  HMB500: `HMB500 BERTH ALLOCATION
VOY NO             5  A registered voyage (HM0301 if not).
BERTH              3  B01 to B06. MAX LOA M per berth is listed on screen.
FROM DT (DDMMYY)   6  Start date.    FROM TM (HHMM)  4  Start time.
TO DT (DDMMYY)     6  End date.      TO TM (HHMM)    4  End time.
All fields are required. Enter only VALIDATES: HM0210 PRESS F10 TO CONFIRM.
NOTHING IS FILED UNTIL F10 (HM0510 BERTH ALLOCATED, form cleared). F12
cancels the confirm so you can edit. A voyage has one booking: filing
again replaces it. Bookings on file are listed under the form.
HM0511 INVALID BERTH. HM0512 LOA EXCEEDS BERTH: vessel too long.
HM0513 INVALID PERIOD: TO is not after FROM. HM0514 BERTH OCCUPIED:
another voyage has the berth in that period.
HM0204 INVALID DATE / HM0205 INVALID TIME name the field.
HM0417 RECORD IN USE BY clerk - RETRY: another clerk has the record open.
Nothing was filed; the form is kept. Press F10 again until it is filed.
F3 leaves and loses the form.`,
  HMT600: `HMT600 TARIFF MAINTENANCE
TRF CD            4  Tariff code.
RATE MRC          7  New rate.
EFF DT (DDMMYY)   6  Effective date.
Enter queues the change for the night run (HM0601).
This Screen belongs to the tariff office. A manifest clerk has no
business here: press F3 to go back to the main menu.`,
  HMA900: `HMA900 ADMINISTRATION
OPR ID   8  The operator to act on.
ACTION   1  S suspend, U unlock, X reset password.
Supervisors only: Enter answers HM0901 NOT AUTHORISED - SUPERVISOR ONLY.
A manifest clerk has no business here: press F3 to go back to the main
menu.`,
  HMX990: `HMX990 SESSION TIMED OUT
The session was idle too long and was closed (HM0990).
Anything keyed but not filed is lost; filed records are kept.
Press Enter, then sign on again and start the unfinished form over.`,
};
