"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { FirstView } from "../domain/first-view";
import { createHarnessQueryClient } from "./list-queries";

/**
 * The Harness's React Query client, created once with the page's first view
 * already in it: the tabs paint it on their first render and do not read it
 * again on mount.
 */
export function HarnessQueryProvider({
  firstView,
  staffId,
  children,
}: {
  firstView: FirstView;
  staffId: string;
  children: ReactNode;
}) {
  const [client] = useState(() => createHarnessQueryClient(firstView, staffId));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
