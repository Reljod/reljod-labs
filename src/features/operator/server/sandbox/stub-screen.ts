import "server-only";
import type { ScreenAction } from "../../domain/actions";
import { inputsOf } from "../../legacy/input";
import { cellAt } from "../../legacy/terminal";
import { ScreenUnavailable } from "../errors";
import type { ScreenPort } from "../ports";
import { createScreenCore, type ScreenCore } from "./screen-core";

/*
 * The stubbed e2e suite's Screen: HARBOURMASTER and the Guard (screen-core.ts,
 * the very code the Screen sandbox runs) in this server process, with no
 * Vercel Sandbox and no browser. Each Action is split into the same atomic
 * steps the sandbox's driver sends, so a pause, a refusal and `skip` after an
 * approval land on the same input. The picture is a plain placeholder: the
 * scripted Operator never looks at it.
 *
 * The machines live on `globalThis`, keyed by run id, so the route handlers,
 * the MCP server and the workflow's steps (all in the one `next dev` or
 * `next start` process the suite runs against) reach the same Screen.
 */

/** A 16 by 10 picture in the terminal's colour, the Screen's 1024 by 640 shape. */
const PLACEHOLDER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAIAAAAy3EnLAAAAEklEQVR4nGNgkOIlDY1qGJoaAE8DGGH8Ykh3AAAAAElFTkSuQmCC";

type Held = { core: ScreenCore; pointer: { x: number; y: number } | null };

const scope = globalThis as { __operatorStubScreens?: Map<string, Held> };
scope.__operatorStubScreens ??= new Map();
const screens = scope.__operatorStubScreens;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function get(runId: string): Held {
  const found = screens.get(runId);
  // The same refusal a Run whose sandbox is gone gets.
  if (!found) throw new ScreenUnavailable(`no stub Screen for Run ${runId}`);
  return found;
}

/** The atomic steps of an Action, one for each the sandbox's driver would send. */
function unitsOf(screen: Held, action: ScreenAction): (() => Promise<void>)[] {
  const take = (input: Parameters<ScreenCore["take"]>[0]) => async () =>
    screen.core.take(input);
  switch (action.type) {
    case "click":
      return [
        async () => {
          screen.pointer = { x: action.x, y: action.y };
          const cell = cellAt(action.x, action.y);
          if (cell) screen.core.take({ kind: "click", ...cell });
        },
      ];
    case "wait":
      return [() => sleep(action.ms)];
    default:
      return inputsOf(action).map(take);
  }
}

export const stubScreen: ScreenPort = {
  available: () => true,
  async boot({ runId, fixture, rulebook }) {
    screens.set(runId, {
      core: createScreenCore({ fixture, rulebook }, Date.now),
      pointer: null,
    });
  },
  async act(runId, _secret, request) {
    const screen = get(runId);
    const started = Date.now();
    screen.core.beginAction();
    try {
      const units = request.action ? unitsOf(screen, request.action) : [];
      for (const unit of units.slice(Math.max(0, request.skip ?? 0))) {
        await unit();
        if (screen.core.blocked()) break;
      }
      return {
        png: PLACEHOLDER_PNG,
        ...screen.core.endAction(screen.pointer, started),
      };
    } finally {
      screen.core.abortAction();
    }
  },
  async approve(runId, _secret, fingerprint) {
    get(runId).core.approve(fingerprint);
  },
  async touch(runId) {
    get(runId).core.touch();
  },
  async extend() {},
  async books(runId) {
    return get(runId).core.report();
  },
  async dispose(runId) {
    screens.delete(runId);
  },
};
