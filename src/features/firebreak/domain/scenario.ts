/**
 * The shape of a Scenario: a company on its worst morning, as data. A
 * Scenario names its six Stakeholders, the Levers a chief executive can pull,
 * the Injects that land on the desk, what keeps burning until something is
 * done, and the Rules the response is judged by. Nothing here runs; the
 * engine (`engine.ts`) and the Rules (`rules.ts`) read it.
 */

/** The six things a crisis burns, one per Stakeholder. Each runs 0 to 100. */
export const GAUGES = [
  "customers",
  "regulator",
  "staff",
  "press",
  "operations",
  "board",
] as const;
export type GaugeId = (typeof GAUGES)[number];
export type Gauges = Record<GaugeId, number>;

/** A change to the Gauges (points) and to the cost of the crisis (florin millions). */
export type Effects = Partial<Gauges> & { cost?: number };

/** Somebody at the table. One per Gauge; the Room speaks in their voice. */
export type Stakeholder = {
  gauge: GaugeId;
  name: string;
  role: string;
  /** Two letters for the seat. */
  initials: string;
  /** How they talk, for the Room. */
  voice: string;
  /** Lines the recorded drill and the stub use, by how the Round went for them. */
  lines: { up: string[]; down: string[] };
};

/** Something the chief executive can do. Taken once; taking it again does nothing. */
export type Lever = {
  id: string;
  label: string;
  /** One line on what it means, shown on the card and given to the Reader. */
  detail: string;
  effects: Effects;
  /** The same decision is worth less later: after `after` hours, gains are multiplied by `factor`. */
  late?: { after: number; factor: number };
};

/** When an Inject may land: Levers taken or not, and Gauges below a line. */
export type Condition = {
  taken?: string[];
  notTaken?: string[];
  below?: Partial<Gauges>;
};

/** A choice offered with an Inject: one or two Levers under one label. */
export type Option = { id: string; label: string; levers: string[] };

/** Something that lands on the desk at a Slot's hour. */
export type Inject = {
  id: string;
  /** Which Slot it can land in (index into `slots`). */
  slot: number;
  /** Who brings it. */
  from: GaugeId;
  title: string;
  body: string;
  /** What it does to the Gauges when it lands, before anything is decided. */
  pressure: Effects;
  when?: Condition;
  options: Option[];
};

/** Damage that repeats every Round until one of `unless` has been taken. */
export type Burn = {
  id: string;
  label: string;
  unless: string[];
  effects: Effects;
};

/** A Rule's kinds; each is checked by code in `rules.ts`. */
export type Rule =
  | {
      id: string;
      kind: "by";
      /** The sentence the Rule says, shown on the Rulebook and in the Review. */
      text: string;
      /** Any one of these, taken by `hour`, meets it. */
      anyOf: string[];
      hour: number;
      source: string;
    }
  | {
      id: string;
      kind: "before";
      text: string;
      /** If `lever` is taken, every one of `first` must already have been. */
      lever: string;
      first: string[];
      source: string;
    }
  | {
      id: string;
      kind: "never";
      text: string;
      lever: string;
      source: string;
    };

/** What a public Statement must and must not say; checked by `statement.ts`. */
export type StatementRules = {
  /** Words that name the people affected; one must appear. */
  who: string[];
  /** Words that tell them what to do; one must appear. */
  action: string[];
  /** Levers whose words a Statement may use only if the Lever was taken. */
  promises: { lever: string; words: string[] }[];
};

export type Scenario = {
  id: string;
  company: string;
  industry: string;
  /** The drill's title, two words at most. */
  title: string;
  /** The opening line, under the title. */
  logline: string;
  /** What the Room knows about the company, a paragraph. */
  brief: string;
  /** The day and time the clock starts, as words. */
  startsAt: string;
  /** Hours after the first Inject at which each Slot lands. */
  slots: number[];
  /** The clock's last hour. */
  hours: number;
  start: Gauges;
  /** How much one florin million of cost moves the share price, in index points. */
  costToShare: number;
  stakeholders: Stakeholder[];
  levers: Lever[];
  injects: Inject[];
  burns: Burn[];
  rules: Rule[];
  statement: StatementRules;
  /** The recorded drill: one Option id per Slot. */
  recorded: string[];
  /** For the map: which Gauge's region each fire starts from. */
  ignition: GaugeId;
};
