"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { DemoBar, demoBarControlClass } from "@/components/demo/demo-bar";
import { type Action, can as roleCan } from "../domain/permissions";
import type { Staff } from "../domain/staff";
import { api, keys } from "./api";
import DemoMode from "./demo-mode/demo-mode";
import { PANELS_ID, PRODUCT_NAME, TAB_LABEL } from "./harness-bar";
import {
  createControllerRegistry,
  HarnessContext,
  type HarnessContextValue,
  hrefOf,
  LINK_PARAMS,
  type LinkParams,
  type Place,
  placeOf,
  TAB_IDS,
  type TabId,
  useController,
  useHarness,
} from "./harness-context";
import AuditTab from "./tabs/audit-tab";
import ChatTab from "./tabs/chat-tab";
import DocsTab from "./tabs/docs-tab";
import KnowledgeTab from "./tabs/knowledge-tab";
import PipelinesTab from "./tabs/pipelines-tab";
import SkillsTab from "./tabs/skills-tab";
import { cx, ErrorNote, Initials, RoleBadge, Spinner, useWrite } from "./ui";
import "../harness.css";

/** The Connect page (`HARNESS_CONNECT_PATH`), named here to keep the MCP tool list out of the browser bundle. */
const CONNECT_PATH = "/demos/harness/mcp";

const TAB_VIEW: Record<TabId, () => React.ReactNode> = {
  chat: ChatTab,
  pipelines: PipelinesTab,
  knowledge: KnowledgeTab,
  skills: SkillsTab,
  audit: AuditTab,
  docs: DocsTab,
};

/** Lays link params over a place: a value opens, null closes, a name left out stays. */
function withParams(place: Place, tab: TabId, params: LinkParams = {}): Place {
  const next = { ...place.params };
  for (const name of LINK_PARAMS) {
    const value = params[name];
    if (value === undefined) continue;
    if (value) next[name] = value;
    else delete next[name];
  }
  return { tab, params: next };
}

const samePlace = (a: Place, b: Place) => hrefOf(a) === hrefOf(b);

/**
 * The Harness shell: the shared demo bar (its tabs, then Connect Claude, Demo
 * mode and who is signed in), and the context every tab reads. A tab is mounted the first time it
 * is opened and then stays mounted, hidden, so a Session that is answering
 * or a Run that is streaming carries on while the person looks elsewhere.
 */
export function HarnessApp({
  initialStaff,
  allStaff,
  initialPlace,
}: {
  initialStaff: Staff;
  allStaff: Staff[];
  initialPlace: Place;
}) {
  const queryClient = useQueryClient();
  const [staff, setStaff] = useState(initialStaff);
  const [place, setPlace] = useState(initialPlace);
  const [visited, setVisited] = useState<TabId[]>(() => [
    ...new Set<TabId>(["chat", initialPlace.tab]),
  ]);
  const [demoOpen, setDemoOpen] = useState(false);
  const [registry] = useState(createControllerRegistry);

  // The address follows the place, so a reload or a shared link lands there.
  const go = useCallback((next: Place) => {
    setPlace((current) => {
      if (samePlace(current, next)) return current;
      const href = hrefOf(next, window.location.pathname);
      // A change of tab is a step back can undo; opening a thing in a tab is not.
      if (current.tab !== next.tab) window.history.pushState(null, "", href);
      else window.history.replaceState(null, "", href);
      return next;
    });
    setVisited((tabs) =>
      tabs.includes(next.tab) ? tabs : [...tabs, next.tab],
    );
  }, []);

  useEffect(() => {
    const onPop = () => {
      const next = placeOf(window.location.search);
      setPlace(next);
      setVisited((tabs) =>
        tabs.includes(next.tab) ? tabs : [...tabs, next.tab],
      );
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const placeRef = useRef(place);
  placeRef.current = place;

  const openTab = useCallback(
    (tab: TabId, params?: LinkParams) =>
      go(withParams(placeRef.current, tab, params)),
    [go],
  );
  const openRun = useCallback(
    (runId: string) => openTab("pipelines", { run: runId }),
    [openTab],
  );
  const openSession = useCallback(
    (sessionId: string | null) => openTab("chat", { session: sessionId }),
    [openTab],
  );
  const hrefFor = useCallback(
    (tab: TabId, params?: LinkParams) =>
      hrefOf(withParams(placeRef.current, tab, params)),
    [],
  );

  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const switchStaff = useCallback(
    async (staffId: string) => {
      if (switchingRef.current) throw new Error("Already changing Staff.");
      switchingRef.current = true;
      setSwitching(true);
      try {
        const { staff: next } = await api.staff.switch({ staffId });
        setStaff(next);
        // Sessions are a Staff member's own: the open one may not be theirs.
        go(
          withParams(placeRef.current, placeRef.current.tab, { session: null }),
        );
        // Everything on screen was read as the Staff member before.
        await queryClient.invalidateQueries({ queryKey: keys.all });
        return next;
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [go, queryClient],
  );

  const value = useMemo<HarnessContextValue>(
    () => ({
      staff,
      allStaff,
      can: (action: Action) => roleCan(staff, action),
      switchStaff,
      switching,
      place,
      sessionId: place.params.session ?? null,
      runId: place.params.run ?? null,
      openTab,
      openRun,
      openSession,
      hrefFor,
      demoOpen,
      setDemoOpen,
      registerController: registry.register,
      controller: registry.get,
    }),
    [
      staff,
      allStaff,
      switchStaff,
      switching,
      place,
      openTab,
      openRun,
      openSession,
      hrefFor,
      demoOpen,
      registry,
    ],
  );

  return (
    <HarnessContext.Provider value={value}>
      <ShellControllers />
      {/*
        The shell is a column the height of the window: the app (which takes
        what is left) and, while Demo mode runs, its guide bar as a sibling,
        in the flow. Nothing is measured, so the app always ends exactly where
        the bar begins. overflow: clip means nothing inside can scroll the
        shell (a focus, a caret, a popover past its edge) and leave a band.
      */}
      <div className="hx-shell flex h-dvh flex-col overflow-clip">
        <div className="hx-root flex min-h-0 flex-1 flex-col bg-marble text-ink">
          <DemoBar
            slug="bank-harness"
            name={PRODUCT_NAME}
            titleAs="h1"
            rowFrom="xl"
            current={place.tab}
            panelsId={PANELS_ID}
            tabs={TAB_IDS.map((tab) => ({
              id: tab,
              label: TAB_LABEL[tab],
              onSelect: () => openTab(tab),
            }))}
          >
            <Link
              href={CONNECT_PATH}
              className={cx(demoBarControlClass, "hidden sm:flex")}
              aria-label="Connect Claude"
              title="Connect Claude to the Harness MCP server"
            >
              <span className="hidden min-[1440px]:inline">Connect</span>
              Claude
            </Link>
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              aria-haspopup="dialog"
              aria-label="Demo mode"
              className={demoBarControlClass}
            >
              Demo<span className="hidden sm:inline">&nbsp;mode</span>
            </button>
            <StaffSwitcher />
          </DemoBar>

          <main className="flex min-h-0 flex-1 flex-col">
            {TAB_IDS.filter((tab) => visited.includes(tab)).map((tab) => {
              const View = TAB_VIEW[tab];
              return (
                <div
                  key={tab}
                  role="tabpanel"
                  id={`${PANELS_ID}-panel-${tab}`}
                  aria-labelledby={`${PANELS_ID}-tab-${tab}`}
                  className={cx(
                    "min-h-0 flex-1 flex-col",
                    place.tab === tab ? "flex" : "hidden",
                  )}
                >
                  <View />
                </div>
              );
            })}
          </main>
        </div>
        <DemoMode open={demoOpen} onClose={() => setDemoOpen(false)} />
      </div>
    </HarnessContext.Provider>
  );
}

/** The two controllers the shell itself answers for Demo mode: `staff` and `tabs`. */
function ShellControllers() {
  const { allStaff, switchStaff, openTab } = useHarness();
  useController("staff", {
    async switch(idOrKey) {
      const member = allStaff.find(
        (item) => item.id === idOrKey || item.key === idOrKey,
      );
      if (!member)
        throw new Error("That Staff member is not in this Workspace.");
      return switchStaff(member.id);
    },
  });
  useController("tabs", {
    async open(tab, params) {
      openTab(tab, params);
      // Let the tab mount and register its own controller before the next Beat.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    },
  });
  return null;
}

/**
 * Who the visitor is signed in as, and the way to be someone else. Anyone in
 * a Workspace may switch to any of its Staff (ADR 0014), so every visitor
 * can try both Roles. Switching is a write: the menu is disabled while it
 * runs and says what happened, or why not, in place.
 */
function StaffSwitcher() {
  const { staff, allStaff, switchStaff } = useHarness();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const write = useWrite(async (staffId: string) => {
    setTarget(staffId);
    const next = await switchStaff(staffId);
    setOpen(false);
    return next;
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !write.pending) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !write.pending) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, write.pending]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-busy={write.pending || undefined}
        onClick={() => {
          write.reset();
          setOpen((current) => !current);
        }}
        className="outline-box press flex h-9 items-center gap-2 rounded-sm bg-paper pr-2 pl-1 text-left"
      >
        <Initials
          initials={staff.initials}
          role={staff.role}
          className="size-6 border"
        />
        <span className="hidden max-w-36 truncate text-xs font-semibold 2xl:block">
          {staff.name}
        </span>
        {/* On a phone the initials' fill tells the Role; the name needs the room. */}
        <span className="hidden sm:contents">
          <RoleBadge role={staff.role} />
        </span>
        <span className="sr-only">
          Signed in as {staff.name}. Change Staff member
        </span>
        <span aria-hidden="true" className="text-xs text-ink-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Sign in as a Staff member"
          className="outline-box absolute right-0 z-40 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-sm bg-paper shadow-hard-md"
        >
          <p className="eyebrow border-ink border-b-2 px-3 py-2 text-[0.65rem] font-bold text-ink-muted">
            Signed in as
          </p>
          <ul className="divide-y divide-ink/10">
            {allStaff.map((member) => {
              const current = member.id === staff.id;
              const busy = write.pending && target === member.id;
              return (
                <li key={member.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    disabled={write.pending || current}
                    onClick={() => void write.run(member.id)}
                    className={cx(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left disabled:cursor-default",
                      current ? "bg-morning-haze" : "hover:bg-marble",
                      write.pending && !busy && !current && "opacity-50",
                    )}
                  >
                    <Initials initials={member.initials} role={member.role} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {member.name}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {busy ? "Signing in…" : member.title}
                      </span>
                    </span>
                    {busy ? <Spinner /> : <RoleBadge role={member.role} />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="space-y-2 border-ink border-t-2 bg-marble px-3 py-2">
            <ErrorNote>{write.error}</ErrorNote>
            <p className="text-xs text-ink-muted">
              A user works cases. An admin also edits Skills and Rules, settles
              Conflicts, gives high-risk Approvals and reads the whole
              Workspace's Audit trail. Every change of Staff is audited.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
