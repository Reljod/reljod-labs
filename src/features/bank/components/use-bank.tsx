"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { isTab, type Tab } from "../domain/api";
import type { CommandName, WriteOutcome } from "../domain/commands";
import type { Staff } from "../domain/staff";
import type { CustomerSummary, OverviewView } from "../domain/views";
import { ApiError, messageOf, readBank, runCommand } from "./api";

/**
 * What every tab of the bank shares: who is signed in, the bank's clock and
 * counts, which customer is open, which tab, and the two hooks every tab
 * reads and writes with (`useRead`, `useCommand`).
 */

/** What the page's server component read before the first paint. */
export type FirstView = {
  overview: OverviewView;
  customers: CustomerSummary[];
  staff: Staff[];
  activeStaffId: string;
  tab: Tab;
  customerId: string | null;
  sessionId: string | null;
};

type BankState = {
  staff: Staff[];
  activeStaff: Staff;
  setActiveStaff: (staff: Staff) => void;
  tab: Tab;
  /** Opens a tab and puts it in the address (`?tab=`), keeping the visit's other params. */
  openTab: (tab: Tab, params?: Record<string, string | null>) => void;
  /** The customer open in the Bank tab (`?customer=`). The Teller assumes this one. */
  customerId: string | null;
  setCustomerId: (id: string | null) => void;
  /** The chat Session the address points at (`?session=`), if any. */
  sessionId: string | null;
  /** Everything read from the bank is stale: read it again. Call after a write. */
  refresh: () => void;
};

const BankContext = createContext<BankState | null>(null);

export function useBank(): BankState {
  const state = useContext(BankContext);
  if (!state) throw new Error("useBank must be used inside BankProvider");
  return state;
}

const keyOf = (name: CommandName, input: Record<string, unknown> = {}) =>
  ["bank", name, input] as const;

function writeAddress(params: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(params)) {
    if (value === null || value === "") url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function BankProvider({ first, children }: { first: FirstView; children: ReactNode }) {
  const [client] = useState(() => {
    const created = new QueryClient({
      defaultOptions: { queries: { staleTime: 4_000, retry: false, refetchOnWindowFocus: false } },
    });
    // The first view is already here: the tabs paint it and do not ask again on mount.
    created.setQueryData(keyOf("get_overview"), first.overview);
    created.setQueryData(keyOf("list_customers"), { customers: first.customers });
    return created;
  });
  const [activeStaff, setActiveStaff] = useState(
    () => first.staff.find((member) => member.id === first.activeStaffId) ?? (first.staff[0] as Staff),
  );
  const [tab, setTab] = useState<Tab>(first.tab);
  const [customerId, setCustomer] = useState<string | null>(first.customerId);

  const openTab = useCallback((next: Tab, params: Record<string, string | null> = {}) => {
    if (!isTab(next)) return;
    setTab(next);
    writeAddress({ tab: next === "bank" ? null : next, ...params });
  }, []);
  const setCustomerId = useCallback((id: string | null) => {
    setCustomer(id);
    writeAddress({ customer: id });
  }, []);
  const refresh = useCallback(() => {
    // A write discards every read still in flight, then reads again
    // ("A read in flight never undoes a write").
    void client.cancelQueries({ queryKey: ["bank"] });
    void client.invalidateQueries({ queryKey: ["bank"] });
  }, [client]);

  const state = useMemo<BankState>(
    () => ({
      staff: first.staff,
      activeStaff,
      setActiveStaff,
      tab,
      openTab,
      customerId,
      setCustomerId,
      sessionId: first.sessionId,
      refresh,
    }),
    [first.staff, first.sessionId, activeStaff, tab, openTab, customerId, setCustomerId, refresh],
  );

  return (
    <QueryClientProvider client={client}>
      <BankContext.Provider value={state}>{children}</BankContext.Provider>
    </QueryClientProvider>
  );
}

/**
 * One read command of the bank, cached and shared between tabs. `T` is the
 * view the command returns (domain/views.ts). The previous data stays on
 * screen while a refetch runs: mark the view `aria-busy` with `isFetching`.
 *
 *   const { data, error, isFetching } = useRead<AccountDetail>("get_account", { accountId });
 */
export function useRead<T>(
  name: CommandName,
  input: Record<string, unknown> = {},
  options: { enabled?: boolean; refetchMs?: number | false } = {},
) {
  return useQuery<T, ApiError>({
    queryKey: keyOf(name, input),
    queryFn: ({ signal }) => readBank<T>(name, input, { signal }),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchMs ?? false,
    placeholderData: (previous) => previous,
  });
}

/**
 * A guarded write for a button ("A write button fires once"). `run` cannot
 * start twice: a ref guard holds from the click. While it runs `pending` is
 * true (disable the button, show a pending label); after it, `outcome` or
 * `error` says what happened, to show where it was clicked. On success every
 * read is refreshed.
 *
 * An outcome is not always "done": `needs_approval` means a supervisor must
 * approve it in Operations; show `outcome.message` either way.
 *
 *   const transfer = useCommand();
 *   <Button disabled={transfer.pending} onClick={() => transfer.run("transfer", { ... })}>
 *     {transfer.pending ? "Sending…" : "Send"}
 *   </Button>
 */
export function useCommand<Result = unknown>() {
  const client = useQueryClient();
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string }[]>([]);
  const [outcome, setOutcome] = useState<WriteOutcome<Result> | null>(null);

  const run = useCallback(
    async (name: CommandName, input: Record<string, unknown>): Promise<WriteOutcome<Result> | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setPending(true);
      setError(null);
      setFieldErrors([]);
      // One key per click: the same click sent twice runs once.
      const key = crypto.randomUUID();
      try {
        const result = await runCommand<Result>(name, input, key);
        setOutcome(result);
        void client.cancelQueries({ queryKey: ["bank"] });
        void client.invalidateQueries({ queryKey: ["bank"] });
        return result;
      } catch (caught) {
        setError(messageOf(caught));
        if (caught instanceof ApiError && caught.errors) setFieldErrors(caught.errors);
        return undefined;
      } finally {
        running.current = false;
        setPending(false);
      }
    },
    [client],
  );

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors([]);
    setOutcome(null);
  }, []);

  return { run, pending, error, fieldErrors, outcome, reset };
}
