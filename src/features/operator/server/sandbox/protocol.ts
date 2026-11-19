import type { ScreenAction } from "../../domain/actions";
import type { GuardDecision } from "../../domain/guard";
import type { Rulebook } from "../../domain/rules";
import type { Books, Change, Fixture, ScreenCode } from "../../legacy/types";

/**
 * What the harness and the process inside the Screen sandbox say to each
 * other. Types only: both sides import this, and the sandbox side is bundled.
 */

export const SCREEN_PORTS = { legacy: 4310, control: 4311 } as const;
export const SCREEN_DIR = "/vercel/sandbox/run";
export const SECRET_HEADER = "x-operator-harness";

/** Written to `${SCREEN_DIR}/config.json` before the process starts. */
export type ScreenConfig = {
  fixture: Fixture;
  rulebook: Rulebook;
  /** The harness's secret for the control port. The page never has it. */
  secret: string;
};

export type ActRequest = {
  /** The Action to perform; null only looks. */
  action: ScreenAction | null;
  /** Atomic inputs of the Action to skip: those already applied before a pause. */
  skip?: number;
};

/** The first input of an Action the Guard did not allow. Nothing after it was sent. */
export type Blocked = {
  decision: Exclude<GuardDecision, { kind: "allow" }>;
  /** How many atomic inputs of the Action were applied before it. */
  applied: number;
  /** The blocked input as a label: `key Enter`, `type "Y"`, `click`. */
  input: string;
};

export type ActResult = {
  /** The Screen after the Action, PNG, base64. */
  png: string;
  screen: ScreenCode;
  /** HARBOURMASTER's message line. */
  message: string;
  caret: { x: number; y: number } | null;
  pointer: { x: number; y: number } | null;
  /** Records this Action committed. */
  changes: Change[];
  /** The Books against the Fixture, when this Action committed something. */
  diff: Change[] | null;
  blocked: Blocked | null;
  /** Totals since the Run started. */
  records: number;
  errors: number;
  signedOn: boolean;
  ms: number;
};

/** The state of the Books for the checks at the end of a Run. */
export type BooksReport = {
  books: Books;
  diff: Change[];
  signedOn: boolean;
  errors: number;
  inputs: number;
  screens: ScreenCode[];
};
