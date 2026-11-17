import { describe, expect, it, vi } from "vitest";
import {
  createControllerRegistry,
  type HarnessControllers,
} from "./harness-context";

const staff = { switch: vi.fn() } as unknown as HarnessControllers["staff"];

describe("createControllerRegistry", () => {
  it("hands back a controller that is registered", async () => {
    const registry = createControllerRegistry();
    registry.register("staff", staff);
    await expect(registry.get("staff")).resolves.toBe(staff);
  });

  it("waits for a controller that registers later", async () => {
    const registry = createControllerRegistry();
    const pending = registry.get("staff", 1_000);
    registry.register("staff", staff);
    await expect(pending).resolves.toBe(staff);
  });

  it("gives up with a message a person can read", async () => {
    const registry = createControllerRegistry();
    await expect(registry.get("chat", 5)).rejects.toThrow(/Open its tab first/);
  });

  it("forgets a controller when its tab unmounts, but not a newer one", async () => {
    const registry = createControllerRegistry();
    const remove = registry.register("staff", staff);
    const newer = { switch: vi.fn() } as unknown as HarnessControllers["staff"];
    registry.register("staff", newer);
    remove();
    await expect(registry.get("staff", 5)).resolves.toBe(newer);
  });
});
