import type { DocumentKind } from "./domain/types";
import type { DocumentScan, ScanState } from "./scan-state";

/** How far one Document's scan has been played back on screen. */
export type DocumentPlay = {
  /** How many of its readings have been revealed. */
  revealed: number;
  /** Whether its Field checks have been stamped. */
  stamped: boolean;
  /** Ticks left on screen after stamping, before moving on. */
  hold: number;
  /** Played to the end: every reading revealed, stamped and held. */
  seen: boolean;
};

export type Playhead = {
  /** The playback this head belongs to; a stale one is never shown. */
  key: unknown;
  /** The Document on screen; null before the first tick. */
  onScreen: DocumentKind | null;
  /** True once the visitor picked the Document on screen: no more auto moves. */
  pinned: boolean;
  documents: Record<DocumentKind, DocumentPlay>;
  finished: boolean;
};

/** Ticks spent on a stamped Document before moving to the next. */
export const HOLD_TICKS = 5;

const FRESH: DocumentPlay = {
  revealed: 0,
  stamped: false,
  hold: 0,
  seen: false,
};

export function startPlayhead(key: unknown): Playhead {
  return {
    key,
    onScreen: null,
    pinned: false,
    documents: {
      identity_document: FRESH,
      proof_of_address: FRESH,
      certified_copy: FRESH,
    },
    finished: false,
  };
}

const hasOutput = (document: DocumentScan) => document.firstOutputAt !== null;

const failed = (document: DocumentScan) =>
  document.stages.parse === "error" || document.stages.read === "error";

/**
 * The Document to show next: of those not yet seen, the one whose output
 * arrived first, or, while none has output, the first in display order.
 */
export function nextDocument(
  head: Playhead,
  scan: ScanState,
  kinds: DocumentKind[],
  exclude: DocumentKind | null = null,
): DocumentKind | null {
  const unseen = kinds.filter(
    (kind) => kind !== exclude && !head.documents[kind].seen,
  );
  const ready = unseen
    .filter((kind) => hasOutput(scan.documents[kind]))
    .sort(
      (a, b) =>
        (scan.documents[a].firstOutputAt ?? 0) -
        (scan.documents[b].firstOutputAt ?? 0),
    );
  return ready[0] ?? unseen[0] ?? null;
}

/**
 * One tick of playback. The Document on screen reveals one reading per tick,
 * then is stamped with its Field checks and held a moment. While following, a
 * Document still waiting on the model gives way to any other that already has
 * output, so a slow first Document never holds the screen.
 */
export function stepPlayhead(
  head: Playhead,
  scan: ScanState,
  kinds: DocumentKind[],
): Playhead {
  if (head.finished) return head;
  let onScreen = head.onScreen ?? nextDocument(head, scan, kinds);
  if (!onScreen) return { ...head, finished: true };

  if (!head.pinned) {
    const current = scan.documents[onScreen];
    const play = head.documents[onScreen];
    if (play.seen || (play.revealed === 0 && !hasOutput(current))) {
      const ready = nextDocument(head, scan, kinds, onScreen);
      if (play.seen) {
        if (!ready) return { ...head, onScreen, finished: true };
        onScreen = ready;
      } else if (ready && hasOutput(scan.documents[ready])) {
        onScreen = ready;
      }
    }
  }

  const document = scan.documents[onScreen];
  const stored = head.documents[onScreen];
  // A retried read starts its readings over; reveal the new ones from there.
  const play = stored.stamped
    ? stored
    : {
        ...stored,
        revealed: Math.min(stored.revealed, document.readings.length),
      };
  const update = (next: Partial<DocumentPlay>, moveTo = onScreen) => ({
    ...head,
    onScreen: moveTo,
    documents: { ...head.documents, [onScreen]: { ...play, ...next } },
  });

  if (play.seen) return { ...head, onScreen };
  if (play.revealed < document.readings.length) {
    return update({ revealed: play.revealed + 1 });
  }
  if (document.checks && !play.stamped) {
    return update({ stamped: true, hold: HOLD_TICKS });
  }
  if (play.stamped || (failed(document) && scan.end)) {
    if (play.hold > 0) return update({ hold: play.hold - 1 });
    const seen = update({ seen: true });
    if (head.pinned) return seen;
    const next = nextDocument(seen, scan, kinds, onScreen);
    return next ? { ...seen, onScreen: next } : { ...seen, finished: true };
  }
  if (scan.end?.status === "failed")
    return { ...head, onScreen, finished: true };
  return { ...head, onScreen };
}

/** The visitor picks a Document: it stays on screen until they follow again. */
export function pinDocument(head: Playhead, kind: DocumentKind): Playhead {
  return { ...head, onScreen: kind, pinned: true };
}

/** Back to following the run: the next tick moves on if this one is done. */
export function followRun(head: Playhead): Playhead {
  return { ...head, pinned: false };
}
