import { describe, expect, it } from "vitest";
import type { DocumentKind } from "./domain/types";
import {
  followRun,
  HOLD_TICKS,
  type Playhead,
  pinDocument,
  startPlayhead,
  stepPlayhead,
} from "./playhead";
import type { ScanEvent } from "./scan-events";
import { initialScanState, type ScanState, scanReducer } from "./scan-state";

const KINDS: DocumentKind[] = [
  "identity_document",
  "proof_of_address",
  "certified_copy",
];

const fold = (events: ScanEvent[]) =>
  events.reduce(scanReducer, initialScanState());

const field = (kind: DocumentKind, at: number): ScanEvent => ({
  at,
  type: "field",
  kind,
  reading: { name: "full_name", value: "A", spanRefs: ["s1"], confidence: 1 },
});

const checks = (kind: DocumentKind, at: number): ScanEvent => ({
  at,
  type: "checks",
  kind,
  checks: [],
  judgments: {
    legible: true,
    tamperingSuspected: false,
    tamperingSpanRefs: [],
    signaturePresent: null,
    notes: "",
  },
});

function tick(head: Playhead, scan: ScanState, times = 1) {
  let next = head;
  for (let index = 0; index < times; index++) {
    next = stepPlayhead(next, scan, KINDS);
  }
  return next;
}

describe("stepPlayhead", () => {
  it("starts on the first Document while nothing has output", () => {
    const head = tick(startPlayhead("k"), initialScanState());
    expect(head.onScreen).toBe("identity_document");
    expect(head.finished).toBe(false);
  });

  it("shows the Document that has output first, not the first in order", () => {
    const scan = fold([field("proof_of_address", 5)]);
    const head = tick(startPlayhead("k"), scan);
    expect(head.onScreen).toBe("proof_of_address");
    expect(head.documents.proof_of_address.revealed).toBe(1);
  });

  it("leaves a waiting Document as soon as another has output", () => {
    const waiting = tick(startPlayhead("k"), initialScanState());
    expect(waiting.onScreen).toBe("identity_document");
    const head = tick(waiting, fold([field("certified_copy", 3)]));
    expect(head.onScreen).toBe("certified_copy");
  });

  it("stays on a Document it has started revealing", () => {
    const scan = fold([
      field("proof_of_address", 1),
      field("identity_document", 2),
    ]);
    const head = tick(startPlayhead("k"), scan, 2);
    expect(head.onScreen).toBe("proof_of_address");
  });

  it("moves on to the next Document with output once one is stamped and held", () => {
    const scan = fold([
      field("proof_of_address", 1),
      checks("proof_of_address", 2),
      field("certified_copy", 3),
    ]);
    // reveal, stamp, hold, then move.
    const head = tick(startPlayhead("k"), scan, 2 + HOLD_TICKS + 1);
    expect(head.documents.proof_of_address.seen).toBe(true);
    expect(head.onScreen).toBe("certified_copy");
  });

  it("finishes once every Document has been seen", () => {
    const scan = fold(
      KINDS.flatMap((kind, index) => [field(kind, index), checks(kind, index)]),
    );
    const head = tick(startPlayhead("k"), scan, 3 * (2 + HOLD_TICKS + 1));
    expect(head.finished).toBe(true);
  });

  it("keeps a pinned Document on screen until the visitor follows again", () => {
    const scan = fold([
      field("identity_document", 1),
      checks("identity_document", 2),
      field("certified_copy", 3),
    ]);
    let head = pinDocument(startPlayhead("k"), "identity_document");
    head = tick(head, scan, 2 + HOLD_TICKS + 3);
    expect(head.onScreen).toBe("identity_document");
    expect(head.documents.identity_document.seen).toBe(true);
    expect(head.finished).toBe(false);

    head = tick(followRun(head), scan);
    expect(head.onScreen).toBe("certified_copy");
  });

  it("never finishes by itself while pinned, even once everything is seen", () => {
    const scan = fold(
      KINDS.flatMap((kind, index) => [field(kind, index), checks(kind, index)]),
    );
    let head = startPlayhead("k");
    for (const kind of KINDS) {
      head = tick(pinDocument(head, kind), scan, 2 + HOLD_TICKS + 1);
    }
    head = tick(head, scan, 20);
    expect(KINDS.every((kind) => head.documents[kind].seen)).toBe(true);
    expect(head.finished).toBe(false);
    expect(tick(followRun(head), scan).finished).toBe(true);
  });

  it("does not jump away from a pinned Document that is still waiting", () => {
    const scan = fold([field("proof_of_address", 1)]);
    const head = tick(
      pinDocument(startPlayhead("k"), "certified_copy"),
      scan,
      3,
    );
    expect(head.onScreen).toBe("certified_copy");
  });
});
