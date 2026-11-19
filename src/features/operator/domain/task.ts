import type { Fixture, RecordKind } from "../legacy/types";
import type { ScriptTurn } from "./actions";

/**
 * A Task: what a person wants done in HARBOURMASTER, in plain words. A
 * sample Task also carries where it starts (its Fixture), what the Books
 * must look like afterwards (its Expectations) and a Script that does it
 * correctly. An own Task has only the words and, perhaps, a Manifest.
 */

/** One change the Books must show after the Run, and nothing beyond these. */
export type Expectation = {
  /** Plain words for the checklist: "Hold placed on MRDU 482113 0 (reason 23)". */
  label: string;
  op: "add" | "update" | "delete";
  record: RecordKind;
  /**
   * Fields that pick the record out: of the record after an add or update,
   * of the record before a delete. Never `lineNo` for an added line.
   */
  where: Record<string, string | number>;
  /** add and update: the values the record must hold afterwards. */
  values?: Record<string, string | number>;
};

export type SampleManifest = {
  /** File name shown to the visitor, such as `corvina-0412n.csv`. */
  name: string;
  /** Where the file is served: `/operator/samples/<name>`. */
  href: string;
  /** The file's text (CSV), as the Operator is given it. */
  text: string;
};

export type SampleTask = {
  id: string;
  title: string;
  /** One line for the card. */
  summary: string;
  /** The Task as a person would write it. Says nothing about keys or Screens. */
  brief: string;
  manifest: SampleManifest | null;
  fixture: Fixture;
  expected: Expectation[];
  /** The traps on the way, for the card: "Dates are DDMMYY", "Needs a person". */
  traps: string[];
  /** Whether a correct Run pauses for a person under the default Rules. */
  needsApproval: boolean;
  /** A correct solution: the stubbed Operator plays it, and a test proves it. */
  script: ScriptTurn[];
};
