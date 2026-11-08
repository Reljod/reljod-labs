import type { ContentBlock } from "../domain/content-tree";

/** A Content block Ledger has pushed onto the Stack. */
export type PlacedBlock = {
  /** Shared by the Stack and the Source blocks, so the Write-up can float one into the other. */
  id: string;
  source: string;
  excerpt: string | null;
  block: ContentBlock;
};
