import type { ContentBlock } from "../domain/content-tree";

/** A Content block Ledger has placed on the Build board. */
export type PlacedBlock = {
  /** Shared by the board and the answer page, so Reform can slide one into the other. */
  id: string;
  source: string;
  excerpt: string | null;
  /** Ledger's words before this block on the answer page; may be empty. */
  join: string;
  block: ContentBlock;
};
