"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  ACCESS_PATH,
  GUESTS_PATH,
  PROFILE_HINT_COOKIE,
  PROFILE_PATH,
  SIGN_IN_PATH,
} from "../constants";
import { currentProfile, type Profile, signOut } from "../server/actions";
import { LocalTime } from "./local-time";

const itemClass =
  "block w-full px-4 py-2.5 text-left font-mono text-xs font-bold tracking-[0.1em] uppercase hover:bg-morning-haze focus-visible:bg-morning-haze focus-visible:outline-none";

/**
 * The header's profile menu. Signing in is optional, so a visitor sees a way
 * to sign in or enter a Guest code; a Host or Guest sees who they are, their
 * settings and a way out. Only a browser that signed in asks the server who
 * it is, so the public pages stay static and cost a visitor nothing.
 */
export function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!document.cookie.includes(`${PROFILE_HINT_COOKIE}=`)) return;
    let live = true;
    currentProfile()
      .then((found) => {
        if (live) setProfile(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
      } else if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const label = profile
    ? profile.kind === "host"
      ? `Profile: ${profile.email}`
      : `Profile: guest, ${profile.label}`
    : "Profile: not signed in";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        data-testid="profile-menu"
        data-profile={profile?.kind ?? "visitor"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={`outline-box press flex size-10 items-center justify-center rounded-sm shadow-hard-sm ${profile ? "bg-federal-blue text-paper" : "bg-paper text-ink"}`}
      >
        <Icon name="profile" size={20} />
      </button>
      {open ? (
        <div
          role="menu"
          className="outline-box absolute top-full right-0 z-30 mt-3 w-64 bg-paper shadow-hard-md"
        >
          <div className="border-ink border-b-2 bg-marble px-4 py-3">
            <p className="eyebrow text-ink-muted">
              {profile
                ? profile.kind === "host"
                  ? "Host"
                  : "Guest"
                : "Profile"}
            </p>
            <p className="mt-1 text-sm font-semibold break-words">
              {profile
                ? profile.kind === "host"
                  ? profile.name || profile.email
                  : profile.label
                : "Not signed in"}
            </p>
            {profile?.kind === "host" && profile.name ? (
              <p className="mt-1 text-xs break-words text-ink-muted">
                {profile.email}
              </p>
            ) : null}
            {profile?.kind === "guest" ? (
              <p className="mt-1 text-xs text-ink-muted">
                Pass good until <LocalTime iso={profile.expiresAt} />
              </p>
            ) : null}
            {profile ? null : (
              <p className="mt-1 text-xs text-ink-muted">
                The site is open to everyone. Only the demos need a sign-in or a
                guest code.
              </p>
            )}
          </div>
          {profile?.kind === "host" ? (
            <>
              <Link href={PROFILE_PATH} role="menuitem" className={itemClass}>
                Profile settings
              </Link>
              <Link href={GUESTS_PATH} role="menuitem" className={itemClass}>
                Guest access
              </Link>
            </>
          ) : null}
          {profile ? (
            <>
              <Link href="/#demos" role="menuitem" className={itemClass}>
                Demos
              </Link>
              <form action={signOut} className="border-ink border-t-2">
                <button type="submit" role="menuitem" className={itemClass}>
                  {profile.kind === "host" ? "Sign out" : "Leave"}
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href={SIGN_IN_PATH} role="menuitem" className={itemClass}>
                Sign in
              </Link>
              <Link href={ACCESS_PATH} role="menuitem" className={itemClass}>
                Enter a guest code
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
