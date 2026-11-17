/**
 * Builds one page of a Corpus Document and records every name it prints, so
 * the Answer key is computed from what was rendered.
 */

import { CLEAN_STYLES, type Party, type Style } from "./parties";
import { MONTHS, PLACES, PRODUCTS, STREETS, TITLES, VESSELS } from "./pools";
import type { Rng } from "./prng";

/** Where a printed name sits; a name split over a page break has two. */
export type Fragment = { page: number; text: string };

export type MentionRecord = {
  party: number;
  /** The surface form, whole. */
  alias: string;
  style: Style;
  fragments: Fragment[];
};

export type Slot = { party: Party; first: boolean };

/** State shared by every page of one Document. */
export type DocState = {
  title: string;
  pages: number;
  mentions: MentionRecord[];
  decoys: Set<string>;
  /** Day counter for dates that move forward through the Document. */
  day: number;
  /** Calendar days per day step, so a 500-page file spans about two years. */
  dayScale: number;
  serial: number;
  domains: string[];
  /** Values fixed for the whole Document (header fields). */
  fixed: Map<string, string>;
};

const STYLE_WEIGHT: Record<Style, number> = {
  full: 5,
  short: 2,
  initials: 1.5,
  initialShort: 1,
  reordered: 2,
  reorderedShort: 1.2,
  caps: 1.5,
  swift: 3,
  swiftReversed: 1.5,
  honorific: 1.5,
  honSurname: 1.5,
  nickname: 1.5,
  translit: 1.8,
  native: 2,
  alt: 1.5,
  orgShort: 1.5,
  lower: 0.7,
  typo: 0.6,
  ocr: 1,
  handle: 1,
};

export const WIDTH = 96;

/** Wraps a paragraph at spaces only, so a name may break across lines. */
export function wrap(text: string, width = WIDTH): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line += ` ${word}`;
  }
  if (line) lines.push(line);
  return lines;
}

export function pad(text: string, width: number) {
  return text.length >= width
    ? `${text}  `
    : text + " ".repeat(width - text.length);
}

export class PageBuilder {
  readonly lines: string[] = [];
  chars = 0;
  readonly doc: DocState;
  readonly page: number;
  readonly rng: Rng;
  constructor(doc: DocState, page: number, rng: Rng) {
    this.doc = doc;
    this.page = page;
    this.rng = rng;
  }

  line(text = "") {
    this.lines.push(text);
    this.chars += text.length + 1;
  }

  para(text: string, indent = "") {
    for (const l of wrap(text, WIDTH - indent.length)) this.line(indent + l);
  }

  /** Aligned text table: columns separated by at least two spaces. */
  table(head: string[], rows: string[][]) {
    const widths = head.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
    );
    const fmt = (cells: string[]) =>
      cells
        .map((c, i) => (i === cells.length - 1 ? c : pad(c, widths[i] + 2)))
        .join("")
        .trimEnd();
    this.line(fmt(head));
    this.line(fmt(widths.map((w) => "-".repeat(w))));
    for (const r of rows) this.line(fmt(r));
  }

  /** Picks a printed form of the party, records the mention, returns the text. */
  name(slot: Slot, styles: Style[]): string {
    const style = this.style(slot, styles);
    const text = slot.party.forms[style] ?? slot.party.canonical;
    this.doc.mentions.push({
      party: slot.party.index,
      alias: text,
      style,
      fragments: [{ page: this.page, text }],
    });
    return text;
  }

  style(slot: Slot, styles: Style[]): Style {
    let options = styles.filter((s) => slot.party.forms[s]);
    if (slot.first) options = options.filter((s) => CLEAN_STYLES.has(s));
    if (options.length === 0) return "full";
    const weights: Partial<Record<Style, number>> = {};
    for (const s of options) weights[s] = STYLE_WEIGHT[s];
    return this.rng.weighted(weights);
  }

  /** Records a name printed half at the end of this page, half on the next. */
  splitName(slot: Slot): [string, string] {
    const style = this.style(
      { ...slot, first: true },
      ["full", "honorific", "short"].filter((s) =>
        (slot.party.forms[s as Style] ?? "").includes(" "),
      ) as Style[],
    );
    const text = slot.party.forms[style] ?? slot.party.canonical;
    const words = text.split(" ");
    const cut = this.rng.int(1, words.length - 1);
    const head = words.slice(0, cut).join(" ");
    const tail = words.slice(cut).join(" ");
    this.doc.mentions.push({
      party: slot.party.index,
      alias: text,
      style,
      fragments: [
        { page: this.page, text: head },
        { page: this.page + 1, text: tail },
      ],
    });
    return [head, tail];
  }

  /** A value chosen once per Document, e.g. a header field. */
  once(key: string, make: () => string): string {
    let value = this.doc.fixed.get(key);
    if (value === undefined) {
      value = make();
      this.doc.fixed.set(key, value);
    }
    return value;
  }

  decoy<T extends string>(text: T): T {
    this.doc.decoys.add(text);
    return text;
  }

  street() {
    return this.decoy(this.rng.pick(STREETS));
  }
  address() {
    return `${this.rng.int(2, 480)} ${this.street()}, ${this.place()} MR${this.rng.int(1, 9)}-${this.rng.int(1000, 9999)}`;
  }
  place() {
    return this.decoy(this.rng.pick(PLACES));
  }
  vessel() {
    return this.decoy(this.rng.pick(VESSELS));
  }
  product() {
    return this.decoy(this.rng.pick(PRODUCTS));
  }
  jobTitle() {
    return this.decoy(this.rng.pick(TITLES));
  }

  /** Today in the Document's calendar (28-day months, 336-day years). */
  private today() {
    return Math.floor(this.doc.day * this.doc.dayScale);
  }
  date(step = 0) {
    this.doc.day += step;
    const today = this.today();
    const day = today % 336;
    const month = Math.floor(day / 28);
    const year = 2025 + Math.floor(today / 336);
    return `${(day % 28) + 1} ${MONTHS[month]} ${year}`;
  }
  swiftDate() {
    const today = this.today();
    const day = today % 336;
    const yy = 25 + Math.floor(today / 336);
    return `${yy}${String(Math.floor(day / 28) + 1).padStart(2, "0")}${String((day % 28) + 1).padStart(2, "0")}`;
  }
  amount(min = 200, max = 480000) {
    const cents = this.rng.int(min * 100, max * 100);
    const whole = String(Math.floor(cents / 100)).replace(
      /\B(?=(\d{3})+(?!\d))/g,
      ",",
    );
    return `${whole}.${String(cents % 100).padStart(2, "0")}`;
  }
  ref(prefix: string) {
    this.doc.serial += this.rng.int(1, 37);
    return `${prefix}-${String(this.doc.serial).padStart(6, "0")}`;
  }
  account() {
    return `MR${this.rng.int(10, 99)}MCBK${String(this.rng.int(0, 99999999)).padStart(8, "0")}${this.rng.int(10, 99)}`;
  }
  bic() {
    return this.rng.pick([
      "MCBKMRPSXXX",
      "SLBKMRPSXXX",
      "PSCOMRP1XXX",
      "CRPTMRPSTRD",
      "AGTHMRP2XXX",
    ]);
  }
  email(slot: Slot) {
    const domain =
      this.doc.domains.length > 0 && this.rng.chance(0.7)
        ? this.rng.pick(this.doc.domains)
        : this.rng.pick(["post.mr", "selenemail.mr", "harbournet.mr"]);
    return slot.party.email
      ? `${slot.party.email}@${domain}`
      : `info@${slot.party.domain ?? domain}`;
  }
}
