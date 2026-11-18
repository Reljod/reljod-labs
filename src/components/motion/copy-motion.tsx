"use client";

import { createContext, type ReactNode, useContext } from "react";

/**
 * Whether shared page copy may move. The About sections render twice: on
 * `/about`, where they animate, and inside Ledger's Ask sessions, where
 * Ledger measures and cuts them, so there they must stay still.
 */
const CopyMotion = createContext(false);

export function CopyMotionProvider({
  animated,
  children,
}: {
  animated: boolean;
  children: ReactNode;
}) {
  return <CopyMotion value={animated}>{children}</CopyMotion>;
}

export function useCopyMotion() {
  return useContext(CopyMotion);
}
