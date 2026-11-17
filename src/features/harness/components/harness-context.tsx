"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import type { Resolution } from "../domain/knowledge";
import type { Action } from "../domain/permissions";
import type { LinkParams, Place, TabId } from "../domain/place";
import type { ParameterValue } from "../domain/rules";
import type { ApprovalView } from "../domain/run";
import type { Staff } from "../domain/staff";

export {
  hrefOf,
  isTabId,
  LINK_PARAMS,
  type LinkParam,
  type LinkParams,
  type Place,
  placeOf,
  TAB_IDS,
  type TabId,
} from "../domain/place";

/**
 * What Demo mode may ask each part of the app to do. A tab registers its
 * controller when it mounts (`useController`), and a Beat calls it through
 * `controller(name)`, so Demo mode drives the real app without reaching into
 * any component. Every method resolves when the thing it started is done (or
 * visibly under way), and rejects with a message a person can read.
 */
export type HarnessControllers = {
  chat: {
    /** Opens a new Session and shows it. Resolves to its id. */
    newSession(): Promise<string>;
    /** Sends a message in the open Session, as if typed. Resolves when it is sent; use `waitIdle` for the answer. */
    send(text: string): Promise<void>;
    /** Attaches a sample file from `public/` (a path such as `/harness/samples/…`) to the next message. */
    attachFixture(path: string): Promise<void>;
    /** Resolves when the Agent has finished answering. */
    waitIdle(): Promise<void>;
  };
  pipelines: {
    /** Shows a Run in the Pipeline view. */
    openRun(runId: string): Promise<void>;
    /** Approves the open Run's pending Approval as the signed-in Staff member. Rejects when their Role may not. */
    approve(note?: string): Promise<void>;
    /** Resolves with the Approval once the open Run is waiting for one. */
    waitForApproval(): Promise<ApprovalView>;
  };
  skills: {
    /** Shows a Rule's card, in its Rulebook. */
    openRule(ruleId: string): Promise<void>;
    /** Changes a Parameter on the open Rule's card, without saving. */
    setParameter(name: string, value: ParameterValue): Promise<void>;
    /** Saves the open Rule as a new Version. */
    save(): Promise<void>;
  };
  knowledge: {
    /** Uploads a sample file from `public/` as a Source and waits for it to be read. */
    uploadFixture(path: string): Promise<void>;
    /** Shows a Conflict: the one named, or the newest open one. Resolves to its id. */
    openConflict(conflictId?: string): Promise<string>;
    /** Settles the open Conflict. */
    resolve(resolution: Resolution): Promise<void>;
  };
  staff: {
    /** Signs in as another Staff member, by id or by seed key (`officer-1`, `officer-2`, `manager`). */
    switch(idOrKey: string): Promise<Staff>;
  };
  tabs: {
    open(tab: TabId, params?: LinkParams): Promise<void>;
  };
};

export type ControllerName = keyof HarnessControllers;

/** How long `controller()` waits for a tab to mount and register before giving up. */
export const CONTROLLER_WAIT_MS = 8_000;

export type HarnessContextValue = {
  /** Who the visitor is signed in as. */
  staff: Staff;
  /** Everyone in the Workspace. */
  allStaff: Staff[];
  /** Whether the signed-in Staff member's Role allows an action. The server checks again. */
  can(action: Action): boolean;
  /** Signs in as another Staff member. Resolves once the app shows them. */
  switchStaff(staffId: string): Promise<Staff>;
  /** True while a change of Staff is being made. */
  switching: boolean;

  /** The tab on show and what is open in it. */
  place: Place;
  /** The Session open in Chat, or null for a new one. */
  sessionId: string | null;
  /** The Run open in Pipelines, if any. */
  runId: string | null;
  /**
   * Goes to a tab. `params` are laid over what is open: a value opens that
   * thing, null closes it, and a name left out stays as it is.
   */
  openTab(tab: TabId, params?: LinkParams): void;
  /** Shows a Run in the Pipelines tab ("View pipeline" in chat). */
  openRun(runId: string): void;
  /** Shows a Session in the Chat tab; null starts a new one. */
  openSession(sessionId: string | null): void;
  /** The address of a tab with things open, for a real link. */
  hrefFor(tab: TabId, params?: LinkParams): string;

  /** Whether the Demo mode panel is open. */
  demoOpen: boolean;
  setDemoOpen(open: boolean): void;

  /**
   * A tab hands Demo mode its controller. Returns the function that takes it
   * back; prefer `useController`, which does both.
   */
  registerController<Name extends ControllerName>(
    name: Name,
    controller: HarnessControllers[Name],
  ): () => void;
  /**
   * The controller of a part of the app, once it has registered. Waits up to
   * `CONTROLLER_WAIT_MS` for a tab that is still mounting (open the tab
   * first), then rejects.
   */
  controller<Name extends ControllerName>(
    name: Name,
  ): Promise<HarnessControllers[Name]>;
};

export const HarnessContext = createContext<HarnessContextValue | null>(null);

/** The Harness shell: who is signed in, where the app is, and how to go elsewhere. */
export function useHarness(): HarnessContextValue {
  const value = useContext(HarnessContext);
  if (!value) throw new Error("useHarness must be used inside the Harness app");
  return value;
}

/**
 * Registers a tab's controller for Demo mode while the tab is mounted. Pass
 * a fresh object each render if you like: the registered methods always call
 * the latest ones.
 */
export function useController<Name extends ControllerName>(
  name: Name,
  controller: HarnessControllers[Name],
): void {
  const { registerController } = useHarness();
  const latest = useRef(controller);
  latest.current = controller;
  useEffect(() => {
    // A stable stand-in whose methods look up the latest ones when called.
    const proxy = new Proxy({} as HarnessControllers[Name], {
      get: (_target, method) =>
        (latest.current as Record<string | symbol, unknown>)[method],
    });
    return registerController(name, proxy);
  }, [name, registerController]);
}

/** The registry behind `registerController` and `controller`. The shell holds one. */
export function createControllerRegistry() {
  const controllers: Partial<HarnessControllers> = {};
  const waiting = new Map<ControllerName, Set<() => void>>();

  function register<Name extends ControllerName>(
    name: Name,
    controller: HarnessControllers[Name],
  ): () => void {
    controllers[name] = controller;
    for (const wake of waiting.get(name) ?? []) wake();
    waiting.delete(name);
    return () => {
      if (controllers[name] === controller) delete controllers[name];
    };
  }

  function get<Name extends ControllerName>(
    name: Name,
    waitMs = CONTROLLER_WAIT_MS,
  ): Promise<HarnessControllers[Name]> {
    const ready = controllers[name];
    if (ready) return Promise.resolve(ready as HarnessControllers[Name]);
    return new Promise((resolve, reject) => {
      const wake = () => {
        clearTimeout(timer);
        resolve(controllers[name] as HarnessControllers[Name]);
      };
      const timer = setTimeout(() => {
        waiting.get(name)?.delete(wake);
        reject(
          new Error(
            `The ${name} part of the app is not ready. Open its tab first.`,
          ),
        );
      }, waitMs);
      const set = waiting.get(name) ?? new Set();
      set.add(wake);
      waiting.set(name, set);
    });
  }

  return { register, get };
}
