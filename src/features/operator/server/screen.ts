import "server-only";
import { Sandbox } from "@vercel/sandbox";
import { LIMITS } from "../domain/limits";
import type { Rulebook } from "../domain/rules";
import type { Fixture } from "../legacy/types";
import {
  type ActRequest,
  type ActResult,
  type BooksReport,
  SCREEN_DIR,
  SCREEN_PORTS,
  type ScreenConfig,
  SECRET_HEADER,
} from "./sandbox/protocol";
import {
  SCREEN_BUNDLE,
  SCREEN_BUNDLE_HASH,
} from "./sandbox/screen-bundle.generated";

/*
 * The harness's side of a Run's Screen sandbox (ADR 0026). One Vercel
 * Sandbox per Run, with no network, forked from a base that already has
 * headless Chromium installed, so a Run's Screen is up in a few seconds. The
 * process inside (sandbox/screen-entry.ts) is HARBOURMASTER, the Guard and
 * the browser driver; this file starts it and talks to its control port with
 * `curl` run inside the sandbox, so any function instance reaches it by name.
 */

/**
 * The base every Run forks: Chromium's headless shell and playwright-core.
 * Bump the suffix when the image must change; the old base is then unused.
 */
const BASE_NAME = "operator-screen-base-v1";
const OP_DIR = "/vercel/sandbox/op";
const BROWSERS = `${OP_DIR}/browsers`;

export const screenName = (runId: string) => `operator-screen-${runId}`;

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Shown to people and to the model; the SDK's own text goes to the log only. */
export class ScreenUnavailable extends Error {
  constructor(detail: string) {
    super("The Screen sandbox is unavailable.");
    this.name = "ScreenUnavailable";
    console.error("[operator] screen sandbox:", detail);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sh(sandbox: Sandbox, script: string, sudo = false) {
  const result = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", script],
    sudo,
  });
  if (result.exitCode !== 0)
    throw new Error(
      `base setup failed (${result.exitCode}): ${(await result.stderr()).slice(-400)}`,
    );
}

/** Builds the base once: about half a minute, with the network on. */
async function buildBase() {
  const base = await Sandbox.create({
    name: BASE_NAME,
    persistent: true,
    snapshotExpiration: 0,
    timeout: 10 * 60_000,
  });
  try {
    await sh(
      base,
      `mkdir -p ${OP_DIR} && cd ${OP_DIR} && npm init -y >/dev/null && npm install --no-audit --no-fund playwright-core@1.65.0`,
    );
    await sh(
      base,
      `cd ${OP_DIR} && PLAYWRIGHT_BROWSERS_PATH=${BROWSERS} npx playwright-core install --with-deps --only-shell chromium && chown -R ubuntu ${OP_DIR}`,
      true,
    );
  } catch (error) {
    // A half-built base must not be forked: remove it so the next Run rebuilds.
    await base.stop().catch(() => {});
    await base.delete().catch(() => {});
    throw error;
  }
  // Stopping a persistent sandbox snapshots its disk; forks start from that.
  await base.stop();
}

/** Makes sure the base exists and is stopped (snapshotted), building it if needed. */
async function ensureBase() {
  for (let attempt = 0; attempt < 60; attempt++) {
    let base: Sandbox;
    try {
      base = await Sandbox.get({ name: BASE_NAME });
    } catch {
      try {
        await buildBase();
        return;
      } catch (error) {
        // Another instance may be building it under the same name: wait for that one.
        if (attempt > 2) throw error;
        await sleep(3000);
        continue;
      }
    }
    if (base.status === "stopped") return;
    await sleep(3000);
  }
  throw new Error("the base sandbox did not become ready");
}

async function fork(runId: string) {
  const params = {
    sourceSandbox: BASE_NAME,
    name: screenName(runId),
    persistent: false,
    networkPolicy: "deny-all" as const,
    timeout: LIMITS.sandboxMinutes * 60_000,
  };
  try {
    return await Sandbox.fork(params);
  } catch {
    await ensureBase();
    return Sandbox.fork(params);
  }
}

async function control<T>(
  sandbox: Sandbox,
  secret: string,
  path: string,
  payload?: unknown,
  timeoutMs = 45_000,
): Promise<T> {
  const args = [
    "-s",
    "-m",
    String(Math.ceil(timeoutMs / 1000)),
    "-H",
    `${SECRET_HEADER}: ${secret}`,
  ];
  if (payload !== undefined)
    args.push(
      "-X",
      "POST",
      "-H",
      "content-type: application/json",
      "--data-raw",
      JSON.stringify(payload),
    );
  args.push(`http://127.0.0.1:${SCREEN_PORTS.control}${path}`);
  const result = await sandbox.runCommand("curl", args);
  const out = await result.stdout();
  if (result.exitCode !== 0 || !out)
    throw new Error(`control ${path} failed (curl ${result.exitCode})`);
  const parsed = JSON.parse(out) as T & { error?: string };
  if (parsed && typeof parsed === "object" && "error" in parsed && parsed.error)
    throw new Error(`control ${path}: ${parsed.error}`);
  return parsed;
}

/**
 * Starts a Run's Screen: forks the base with no network, writes the Screen
 * process and its config (the Fixture, the Rulebook, the harness's secret),
 * starts it and waits until the browser shows the sign-on Screen.
 */
export async function bootScreen(input: {
  runId: string;
  fixture: Fixture;
  rulebook: Rulebook;
  secret: string;
}) {
  try {
    const sandbox = await fork(input.runId);
    // Forks copy the source's policy; say it again so it never depends on the base.
    await sandbox.update({ networkPolicy: "deny-all" });
    const config: ScreenConfig = {
      fixture: input.fixture,
      rulebook: input.rulebook,
      secret: input.secret,
    };
    await sandbox.writeFiles([
      { path: `${OP_DIR}/screen-${SCREEN_BUNDLE_HASH}.cjs`, content: SCREEN_BUNDLE },
      { path: `${SCREEN_DIR}/config.json`, content: JSON.stringify(config) },
    ]);
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `cd ${OP_DIR} && PLAYWRIGHT_BROWSERS_PATH=${BROWSERS} exec node screen-${SCREEN_BUNDLE_HASH}.cjs > ${SCREEN_DIR}/screen.log 2>&1`,
      ],
      detached: true,
    });
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await control(sandbox, input.secret, "/health", undefined, 3000);
        return;
      } catch {
        await sleep(400);
      }
    }
    const log = await sandbox
      .runCommand("sh", ["-c", `tail -c 600 ${SCREEN_DIR}/screen.log`])
      .then((result) => result.stdout())
      .catch(() => "");
    throw new Error(`the Screen process did not start: ${log}`);
  } catch (error) {
    await disposeScreen(input.runId);
    throw new ScreenUnavailable(message(error));
  }
}

async function screenOf(runId: string) {
  try {
    return await Sandbox.get({ name: screenName(runId) });
  } catch (error) {
    throw new ScreenUnavailable(message(error));
  }
}

async function call<T>(
  runId: string,
  secret: string,
  path: string,
  payload?: unknown,
): Promise<T> {
  const sandbox = await screenOf(runId);
  try {
    return await control<T>(sandbox, secret, path, payload);
  } catch (error) {
    throw new ScreenUnavailable(message(error));
  }
}

/** Performs one Action on the Screen, through the Guard, and returns the picture. */
export const screenAct = (runId: string, secret: string, request: ActRequest) =>
  call<ActResult>(runId, secret, "/act", request);

/** Tells the Guard a person approved exactly this change (good for one commit). */
export const screenApprove = (
  runId: string,
  secret: string,
  fingerprint: string,
) => call<{ ok: true }>(runId, secret, "/approve", { fingerprint });

/** Keeps HARBOURMASTER's session from timing out while the harness, not the driver, is waiting. */
export const screenTouch = (runId: string, secret: string) =>
  call<{ ok: true }>(runId, secret, "/touch", {});

/** The Books as they are now, for the checks. */
export const screenBooks = (runId: string, secret: string) =>
  call<BooksReport>(runId, secret, "/books");

/** Stops and deletes a Run's Screen sandbox, if it has one. Best effort. */
export async function disposeScreen(runId: string) {
  try {
    const sandbox = await Sandbox.get({ name: screenName(runId) });
    await sandbox.stop().catch(() => {});
    await sandbox.delete();
  } catch {
    // None was made, or it is already gone.
  }
}
