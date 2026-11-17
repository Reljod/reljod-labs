/**
 * Reading an Employer's Schedule from CSV text (an `.xlsx` is turned into the
 * same text first, with `readXlsx`). Pure and forgiving about layout: notes
 * above the header, any column order, `CI$` and thousands separators, a
 * Total row at the end. Anything it cannot read becomes a problem, never a
 * guess.
 */

export type ScheduleLineIn = {
  /** 1-based position among the Schedule's lines. */
  line: number;
  memberNo: string;
  memberName: string;
  earningsKyd: number;
  employeeKyd: number;
  employerKyd: number;
  voluntaryKyd: number;
};

export type ParsedSchedule = {
  employerCode: string | null;
  employerName: string | null;
  /** `YYYY-MM`, when the file says. */
  period: string | null;
  lines: ScheduleLineIn[];
  /** What could not be read, one line each. */
  problems: string[];
};

/** Employer codes look like `ER-1001`. */
export const EMPLOYER_CODE = /\bER-\d{4}\b/i;

const MAX_LINES = 400;

/** Splits CSV text into rows of cells, honouring quotes. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((cells) => cells.map((value) => value.trim()));
}

type Column =
  | "memberNo"
  | "memberName"
  | "earnings"
  | "employee"
  | "employer"
  | "voluntary";

function columnOf(header: string): Column | null {
  const name = header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!name) return null;
  if (/\bname\b/.test(name)) return "memberName";
  if (/\bvoluntary\b|\bavc\b/.test(name)) return "voluntary";
  if (/\bearning|\bsalary\b|\bwages?\b/.test(name)) return "earnings";
  if (/\bemployer\b/.test(name)) return "employer";
  if (/\bemployee\b/.test(name)) return "employee";
  if (/\bmember\b.*\b(no|number|id)\b|\baccount\b/.test(name))
    return "memberNo";
  return null;
}

function money(value: string | undefined): number | null {
  if (value === undefined) return null;
  const cleaned = value.replace(/ci\$|kyd|\$|,|\s/gi, "");
  if (cleaned === "" || cleaned === "-") return 0;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

const PERIOD_IN_TEXT = /\b(20\d{2})-(0[1-9]|1[0-2])\b/;

/** Reads a Schedule from CSV text. */
export function parseSchedule(text: string): ParsedSchedule {
  const problems: string[] = [];
  let employerCode: string | null = null;
  let employerName: string | null = null;
  let period: string | null = null;

  const rows = csvRows(text);
  const lookAtNote = (raw: string) => {
    const note = raw.replace(/^#\s*/, "");
    const code = EMPLOYER_CODE.exec(note)?.[0];
    if (code && !employerCode) employerCode = code.toUpperCase();
    const named = /^employer\s*:\s*(.+?)(?:\s*\(ER-\d{4}\))?\s*$/i.exec(note);
    if (named?.[1] && !employerName) employerName = named[1].trim();
    if (/period|month/i.test(note)) {
      const found = PERIOD_IN_TEXT.exec(note);
      if (found && !period) period = `${found[1]}-${found[2]}`;
    }
  };

  let headerIndex = -1;
  let columns: (Column | null)[] = [];
  for (let index = 0; index < rows.length; index++) {
    const cells = rows[index] ?? [];
    const joined = cells.filter(Boolean).join(" ");
    if (!joined) continue;
    if (joined.startsWith("#")) {
      lookAtNote(joined);
      continue;
    }
    const mapped = cells.map(columnOf);
    if (mapped.includes("memberNo") && mapped.includes("earnings")) {
      headerIndex = index;
      columns = mapped;
      break;
    }
    lookAtNote(joined);
  }
  if (headerIndex < 0) {
    return {
      employerCode,
      employerName,
      period,
      lines: [],
      problems: [
        "No header row with a member number and earnings column was found.",
      ],
    };
  }
  for (const needed of ["employee", "employer"] as const) {
    if (!columns.includes(needed))
      problems.push(`The Schedule has no ${needed} contribution column.`);
  }

  const at = (cells: string[], column: Column) => {
    const index = columns.indexOf(column);
    return index < 0 ? undefined : cells[index];
  };
  const lines: ScheduleLineIn[] = [];
  for (const cells of rows.slice(headerIndex + 1)) {
    if (cells.every((cell) => cell === "")) continue;
    const first = (cells[0] ?? "").toLowerCase();
    if (first.startsWith("#")) {
      lookAtNote(cells.join(" "));
      continue;
    }
    if (/^total/.test(first) || /^total/i.test(at(cells, "memberNo") ?? "")) {
      continue;
    }
    if (lines.length >= MAX_LINES) {
      problems.push(`Only the first ${MAX_LINES} lines were read.`);
      break;
    }
    const position = lines.length + 1;
    const memberNo = (at(cells, "memberNo") ?? "").toUpperCase();
    const earnings = money(at(cells, "earnings"));
    const employee = money(at(cells, "employee"));
    const employer = money(at(cells, "employer"));
    const voluntary = money(at(cells, "voluntary")) ?? 0;
    if (!memberNo) {
      problems.push(`Line ${position} has no member number and was left out.`);
      continue;
    }
    if (earnings === null || employee === null || employer === null) {
      problems.push(
        `Line ${position} (${memberNo}) has an amount that is not a number and was left out.`,
      );
      continue;
    }
    lines.push({
      line: position,
      memberNo,
      memberName: at(cells, "memberName") ?? "",
      earningsKyd: earnings,
      employeeKyd: employee,
      employerKyd: employer,
      voluntaryKyd: voluntary,
    });
  }
  if (lines.length === 0) problems.push("The Schedule has no lines.");
  return { employerCode, employerName, period, lines, problems };
}

/** What one line pays in: employee, employer and voluntary together. */
export function lineTotal(
  line: Pick<ScheduleLineIn, "employeeKyd" | "employerKyd" | "voluntaryKyd">,
): number {
  return line.employeeKyd + line.employerKyd + line.voluntaryKyd;
}

export function scheduleTotal(lines: ScheduleLineIn[]): number {
  return (
    Math.round(lines.reduce((sum, line) => sum + lineTotal(line), 0) * 100) /
    100
  );
}
