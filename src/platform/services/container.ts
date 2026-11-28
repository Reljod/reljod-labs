import type { RequestMode } from "../request/mode";

/**
 * A feature's composition root: the one place its services are wired to
 * their adapters (Postgres, the model gateway, Storage, a Sandbox). `build`
 * is called once per instance for live requests and once for stubbed e2e
 * requests, so routes, MCP tools and workflow steps share the same objects.
 *
 *   export const floorwalk = container(({ stub }) =>
 *     createFloorwalkServices({ walker: stub ? stubWalker : geminiWalker, … }));
 *
 * Services depend only on the ports they are handed (interfaces in the
 * feature's `server/ports.ts`), so a unit test builds them with fakes and
 * never touches this file.
 */
export function container<S>(
  build: (mode: { stub: boolean }) => S,
): (mode?: Pick<RequestMode, "stub">) => S {
  let live: S | undefined;
  let stubbed: S | undefined;
  return (mode) => {
    if (mode?.stub) {
      stubbed ??= build({ stub: true });
      return stubbed;
    }
    live ??= build({ stub: false });
    return live;
  };
}
