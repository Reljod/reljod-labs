"use client";

import { createContext, type RefObject, useContext } from "react";
import type { CatPose } from "./cat";

/**
 * What the hero's chat box and the cat peeking beside it share with the page
 * around them: the page decides when the box is pushed into the dock.
 */
export type LedgerDesk = {
  /** The home page's chat box is still in the hero (not yet pushed into the dock). */
  inHero: boolean;
  /** The cat has jumped out of the hero onto the stage. */
  catLeft: boolean;
  pose: CatPose;
  pending: boolean;
  notice: string | null;
  boxRef: RefObject<HTMLElement | null>;
  catRef: RefObject<HTMLDivElement | null>;
  ask: (question: string) => void;
  typing: (active: boolean) => void;
};

export const LedgerDeskContext = createContext<LedgerDesk | null>(null);

export const useLedgerDesk = () => useContext(LedgerDeskContext);
