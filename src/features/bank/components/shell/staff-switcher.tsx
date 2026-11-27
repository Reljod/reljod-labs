"use client";

import { useCallback, useId, useRef, useState } from "react";
import { switchStaff } from "../api";
import { cx, ErrorNote, Initials, RoleBadge, Spinner, useWrite } from "../ui";
import { useBank } from "../use-bank";
import { useDismiss } from "./use-dismiss";

/**
 * Who the visitor is signed in as, and the way to be someone else. Anyone in
 * a bank may switch to any of its Staff, so every visitor can try each Role
 * and see maker-checker work. Switching is a write: the menu is disabled
 * while it runs and says what happened, or why not, in place.
 */
export function StaffSwitcher() {
  const { staff, activeStaff, setActiveStaff, refresh } = useBank();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const write = useWrite(async (staffId: string) => {
    setTarget(staffId);
    const answer = await switchStaff(staffId);
    if (!answer.ok) throw new Error(answer.error);
    setActiveStaff(answer.value);
    // Everything on screen was read as the Staff member before.
    refresh();
    setOpen(false);
    return answer.value;
  });
  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close, write.pending);

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
        data-testid="bank-staff-switcher"
        className="outline-box press flex h-9 items-center gap-2 rounded-sm bg-paper pr-2 pl-1 text-left"
      >
        <Initials
          initials={activeStaff.initials}
          role={activeStaff.role}
          className="size-6 border"
        />
        <span className="hidden max-w-32 truncate text-xs font-semibold 2xl:block">
          {activeStaff.name}
        </span>
        <span className="hidden sm:contents xl:hidden 2xl:contents">
          <RoleBadge role={activeStaff.role} />
        </span>
        <span className="sr-only">
          Signed in as {activeStaff.name}. Change Staff member
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
          className="outline-box absolute top-full right-0 z-40 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-sm bg-paper shadow-hard-md"
        >
          <p className="eyebrow border-ink border-b-2 px-3 py-2 text-[0.65rem] font-bold text-ink-muted">
            Signed in as
          </p>
          <ul className="divide-y divide-ink/10">
            {staff.map((member) => {
              const current = member.id === activeStaff.id;
              const busy = write.pending && target === member.id;
              return (
                <li key={member.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    disabled={write.pending || current}
                    onClick={() => void write.run(member.id)}
                    data-testid={`bank-staff-${member.key}`}
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
              A teller serves Customers and moves money. A supervisor also gives
              Approvals, edits Rules and reverses Entries. A compliance officer
              decides Alerts and KYC. Every change of Staff is audited.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
