/*
 * How Canvas asks Vercel Sandbox for things, in one place and pure, so a
 * test can hold it to the rule: **a Sandbox leaves no snapshot behind**.
 *
 * `@vercel/sandbox` v3 makes every named Sandbox persistent by default: each
 * stop writes a snapshot of the whole disk, kept for 30 days, and `delete()`
 * keeps them unless asked. That filled the account's snapshot storage once.
 * So: nothing here is persistent, the one snapshot Canvas takes on purpose
 * (the image) expires, and disposing of a Sandbox takes its snapshots too.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const SANDBOX_REGION = "syd1";

/** How long an Owner's Sandbox runs before it stops by itself. */
export const SANDBOX_MINUTES = 20;
export const BUILD_MINUTES = 12;

/** The image snapshot lives this long, then Vercel deletes it and the next Question builds a new one. */
export const IMAGE_KEEP_DAYS = 3;
/** An image this close to its end is rebuilt, so no Sandbox starts from one about to vanish. */
const IMAGE_MARGIN_MS = 6 * 60 * MINUTE;

/** The microVM the image is built in: unnamed, never persistent. */
export function imageBuildOptions() {
  return {
    runtime: "python3.13",
    region: SANDBOX_REGION,
    timeout: BUILD_MINUTES * MINUTE,
    resources: { vcpus: 2 },
    persistent: false,
  } as const;
}

/** The one snapshot Canvas takes on purpose. Bounded: `0` would mean "never expire". */
export function imageSnapshotOptions() {
  return { expiration: IMAGE_KEEP_DAYS * DAY } as const;
}

/** Whether an image built at `builtAt` can still be started from. */
export function imageIsFresh(builtAt: Date | null, now = Date.now()) {
  if (!builtAt) return false;
  return now - builtAt.getTime() < IMAGE_KEEP_DAYS * DAY - IMAGE_MARGIN_MS;
}

/**
 * An Owner's Sandbox: from the image, no network, not persistent. It holds
 * nothing that must outlive it (the Catalog is in the image), so when it
 * stops its disk is simply gone and the next Query starts a fresh one.
 */
export function ownerSandboxOptions(name: string, snapshotId: string) {
  return {
    name,
    source: { type: "snapshot", snapshotId },
    networkPolicy: "deny-all",
    timeout: SANDBOX_MINUTES * MINUTE,
    persistent: false,
    resources: { vcpus: 2 },
  } as const;
}

/**
 * Applied after `getOrCreate`, because a Sandbox that already exists keeps
 * the settings it was made with (it may predate this rule).
 */
export function ownerSandboxUpdate() {
  return { persistent: false, networkPolicy: "deny-all" } as const;
}

/** Disposing of a Sandbox takes every snapshot it left with it. */
export function disposeOptions() {
  return { deleteOrphanSnapshots: true } as const;
}
