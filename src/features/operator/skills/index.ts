import { rulebookText, type Rulebook } from "../domain/rules";
import { KEY_LEGEND, MANUAL, MESSAGES } from "../legacy/manual";
import { GEOMETRY, SCREEN_TITLES, type ScreenCode } from "../legacy/types";

/**
 * The Operator's Skills: playbooks loaded on demand with `load_skill`. Only
 * the one-line descriptions are in its instructions until it asks. The desk
 * manual comes from `legacy/manual.ts`, so it cannot drift from the machine.
 */

export type Skill = {
  id: string;
  title: string;
  /** One line, always in the instructions. */
  description: string;
  body: (rulebook: Rulebook) => string;
};

const READING = `# Reading a terminal Screen

The picture is ${GEOMETRY.width} by ${GEOMETRY.height} pixels: 80 columns by 24 rows of text, each cell 12 by 24 pixels, the grid starting 32 pixels in from the top left.

- Row 1, left: the Screen code (HMV200). Read it first, every time. If it is not the Screen you expected, stop and work out why before typing anything.
- Row 2: the Screen's title.
- The second row from the bottom is the message line. A message starts with a code (HM0321). Red or reversed means an error: nothing was saved. Read it before the next key.
- The bottom row lists the function keys that work on this Screen. A key not listed there does nothing but raise an error.
- Underlined cells are input fields. The blinking block is the cursor: typing goes there and nowhere else.
- A box drawn over the Screen is a confirmation. It wants Y or N, then Enter. Nothing else works until it is answered.
- PAGE 1 OF 2 means there is more: F8 goes forward, F7 back.

Habits that keep you out of trouble:
- After a key that should save, look for the message that says it did (ADDED, REGISTERED, AMENDED, PLACED). No message, no save.
- Fields do not tell you when they are full. Extra characters are dropped silently. Count the width in the manual and type exactly what fits.
- Tab moves to the next field. Do not assume the cursor moved by itself.
- You can click a field to put the cursor there, and click a key in the bottom row instead of pressing it.`;

const KEYING = `# Keying a Manifest

1. Before you start, load the manual for the line entry Screen and note every field's width and format.
2. Normalise each row first. If the Manifest has more than a few rows, use run_code: parse the file, check every container number's ISO 6346 check digit, and print each row exactly as it must be typed (container as 11 characters with no spaces, weight as digits only, goods cut to the field width, everything upper case).
3. Key one line per turn: type a field, Tab, type the next, and so on, then the key that saves. You can send all of that in one turn. Then look at the Screen: the message must say the line was added, with its number.
4. If the message is an error, read it, fix that one field and save again. Do not key the next row on top of a failed one.
5. Never retype a row that was saved. If you are not sure, go back to the list and look.
6. When every row is in, page through the list once and compare it with the Manifest, or diff it with run_code (keyed.json holds what the Books have gained in this Run).

Things HARBOURMASTER will not tell you:
- A container typed with spaces is cut to its first 11 characters and saved wrong. The Rules refuse a container whose check digit fails, so a refusal there means you typed it wrong, not that the Rule is in your way.
- Dates are DDMMYY and times HHMM, with no separators.
- A weight longer than the field loses its last digits.`;

const RECOVERING = `# Recovering: timeouts, locks, refusals and pauses

Session timed out (HMX990): the session ended because nothing was keyed for a while. What was saved is still saved; a half-filled form is gone. Press Enter, sign on again, go back to where you were, and check the list before retyping anything so you do not key a line twice.

Record in use (HM0417 RECORD IN USE BY ...): another clerk has the record open. Nothing is wrong with what you typed. Keep the form as it is and press the confirm key again. It can take a few tries. Do not retype the form and do not leave the Screen.

A Rule refused your key: the key was not pressed and HARBOURMASTER saw nothing. The reason is in the tool result. Fix what the Rule names (a wrong container number, a field you must not change, a Screen you may not enter) and carry on. Never try to get the same change through another way.

The Run paused for a person: a guarded key (releasing a hold, deleting a line) waits for the person watching. You cannot approve it. If they approve, the harness presses the key for you and you carry on from the Screen you are shown. If they refuse, leave that change undone, do the rest of the Task, and say so in your summary.

Lost: press F3 until you are back at the main menu (HMM100) and start that part again. F12 cancels a pending confirmation without saving.`;

const manual = () =>
  [
    "# HARBOURMASTER desk manual",
    KEY_LEGEND,
    ...(Object.keys(MANUAL) as ScreenCode[]).map(
      (code) => `## ${code} ${SCREEN_TITLES[code]}\n${MANUAL[code]}`,
    ),
    "## Messages",
    ...Object.entries(MESSAGES).map(([code, text]) => `${code}: ${text}`),
  ].join("\n\n");

export const SKILLS: Skill[] = [
  {
    id: "desk-manual",
    title: "HARBOURMASTER desk manual",
    description:
      "Every Screen's fields, widths, formats, keys and messages. Load it before keying anything.",
    body: manual,
  },
  {
    id: "reading-the-screen",
    title: "Reading a terminal Screen",
    description:
      "Where the Screen code, message line, cursor and key legend are, and what to check after every key.",
    body: () => READING,
  },
  {
    id: "keying-a-manifest",
    title: "Keying a Manifest",
    description:
      "How to key Manifest rows without errors: normalise with code first, one line per turn, verify.",
    body: () => KEYING,
  },
  {
    id: "recovering",
    title: "Recovering from a timeout, a lock, a refusal or a pause",
    description:
      "What to do when the session times out, a record is locked, a Rule refuses a key or the Run pauses.",
    body: () => RECOVERING,
  },
  {
    id: "rules",
    title: "The Rules of this Run",
    description: "The Rulebook this Run is under, as sentences.",
    body: (rulebook) =>
      `# The Rules of this Run\n\n${rulebookText(rulebook)}\n\nCode applies these, not you. Knowing them saves you refused keys.`,
  },
];

export const SKILL_IDS = SKILLS.map((skill) => skill.id);

export const skillById = (id: string) =>
  SKILLS.find((skill) => skill.id === id);
