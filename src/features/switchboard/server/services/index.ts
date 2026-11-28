import "server-only";
import type { SwitchboardPorts } from "../ports";
import { type CallsService, createCallsService } from "./calls";
import { type ConnectService, createConnectService } from "./connect";
import { createOfficeService, type OfficeService } from "./office";
import { createRulesService, type RulesService } from "./rules";
import { createWrapupService, type WrapupService } from "./wrapup";

/**
 * Everything Switchboard does, by area. The REST routes, the MCP server, the
 * page and the Call's Workflow steps are thin adapters over these, so the
 * same Rules, caps and trail apply whoever asks.
 */
export type SwitchboardServices = {
  office: OfficeService;
  rules: RulesService;
  calls: CallsService;
  connect: ConnectService;
  wrapup: WrapupService;
};

export function createSwitchboardServices(
  ports: SwitchboardPorts,
): SwitchboardServices {
  return {
    office: createOfficeService(ports),
    rules: createRulesService(ports),
    calls: createCallsService(ports),
    connect: createConnectService(ports),
    wrapup: createWrapupService(ports),
  };
}
