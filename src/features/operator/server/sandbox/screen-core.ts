import { afterCommit, type GuardLedger, guard } from "../../domain/guard";
import type { Rulebook } from "../../domain/rules";
import { diffBooks } from "../../legacy/books";
import { boot, render, step } from "../../legacy/machine";
import { pointOf, screenHtml, screenText } from "../../legacy/terminal";
import {
  type Fixture,
  type LegacyInput,
  type LegacyState,
  ROWS,
  type ScreenCode,
} from "../../legacy/types";
import type { ActResult, Blocked, BooksReport } from "./protocol";

/*
 * HARBOURMASTER with the Guard in front of it, for one Run: the part of the
 * Screen process that decides (ADR 0025, 0026). Pure apart from the clock it
 * is handed, so the same code runs in the Screen sandbox (screen-entry.ts,
 * behind a headless browser) and in the stubbed e2e suite's in-process Screen
 * (stub-screen.ts), and the Guard judges every key the same way in both.
 */

export type ScreenCore = ReturnType<typeof createScreenCore>;

/** The input as the Trail names it: `key Enter`, `type "Y"`, `click`. */
const inputLabel = (input: LegacyInput) =>
  input.kind === "key"
    ? `key ${input.key}`
    : input.kind === "char"
      ? `type "${input.char}"`
      : "click";

export function createScreenCore(
  config: { fixture: Fixture; rulebook: Rulebook },
  now: () => number,
) {
  let state: LegacyState = boot(config.fixture, now());
  let ledger: GuardLedger = { records: 0, approved: [] };
  const screens = new Set<ScreenCode>([state.screen]);

  /** The Action in flight: what it committed, and the input the Guard stopped. */
  let current: {
    changes: ActResult["changes"];
    applied: number;
    blocked: Blocked | null;
  } | null = null;

  return {
    /** One input: through the Guard, then into HARBOURMASTER. */
    take(input: LegacyInput) {
      // After the Guard stops an input, the rest of that Action is dropped.
      if (current?.blocked) return;
      const next = step(state, input, now());
      const changes = diffBooks(state.books, next.books);
      const decision = guard(config.rulebook, ledger, {
        from: state.screen,
        to: next.screen,
        changes,
      });
      if (decision.kind !== "allow") {
        if (current)
          current.blocked = {
            decision,
            applied: current.applied,
            input: inputLabel(input),
          };
        return;
      }
      state = next;
      ledger = afterCommit(config.rulebook, ledger, changes);
      screens.add(state.screen);
      if (current) {
        current.applied += 1;
        current.changes.push(...changes);
      }
    },

    /** Starts recording what one Action does. */
    beginAction() {
      current = { changes: [], applied: 0, blocked: null };
    },

    /** Whether the Guard stopped an input of the Action in flight. */
    blocked: () => Boolean(current?.blocked),

    /** What the Action in flight did, without the picture; ends the recording. */
    endAction(
      pointer: ActResult["pointer"],
      startedAt: number,
    ): Omit<ActResult, "png"> {
      const turn = current ?? { changes: [], applied: 0, blocked: null };
      current = null;
      const screen = render(state, now());
      const text = screenText(screen);
      return {
        screen: screen.code,
        message: (text[ROWS - 2] ?? "").trim(),
        caret: screen.cursor
          ? pointOf(screen.cursor.row, screen.cursor.col)
          : null,
        pointer,
        changes: turn.changes,
        diff:
          turn.changes.length > 0
            ? diffBooks(config.fixture.books, state.books)
            : null,
        blocked: turn.blocked,
        records: ledger.records,
        errors: state.errors,
        signedOn: state.signedOn,
        ms: now() - startedAt,
      };
    },

    /** Drops the Action in flight (it failed). */
    abortAction() {
      current = null;
    },

    /** The terminal as HTML, as the legacy web app shows it. */
    html: () => screenHtml(render(state, now())),

    /** A person approved exactly this change; it is good for one commit. */
    approve(fingerprint: string) {
      ledger = { ...ledger, approved: [...ledger.approved, fingerprint] };
      // The session must not time out because a person took their time.
      state = { ...state, lastInputAt: now() };
    },

    /** Keeps the session alive while the harness, not the driver, waits. */
    touch() {
      state = { ...state, lastInputAt: now() };
    },

    /** The Books as they are now, for the checks. */
    report: (): BooksReport => ({
      books: state.books,
      diff: diffBooks(config.fixture.books, state.books),
      signedOn: state.signedOn,
      errors: state.errors,
      inputs: state.inputs,
      screens: [...screens],
    }),
  };
}
