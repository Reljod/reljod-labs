import { describe, expect, it } from "vitest";
import {
  callbackTrust,
  callbackVouched,
  issuedAfterEpoch,
} from "./mcp-clients";

describe("callback trust", () => {
  it("trusts loopback http and the listed hosted clients", () => {
    expect(callbackTrust("http://127.0.0.1:3333/callback")).toBe("local");
    expect(callbackTrust("http://localhost/cb")).toBe("local");
    expect(callbackTrust("https://claude.ai/api/mcp/auth_callback")).toBe(
      "known",
    );
    expect(callbackTrust("https://chatgpt.com/connector")).toBe("known");
  });

  it("does not trust any other host, a look-alike or plain http", () => {
    expect(callbackTrust("https://evil.example/cb")).toBe("unknown");
    expect(callbackTrust("https://claude.ai.evil.example/cb")).toBe("unknown");
    expect(callbackTrust("https://evil.claude.ai/cb")).toBe("unknown");
    expect(callbackTrust("http://claude.ai/cb")).toBe("unknown");
    expect(callbackTrust("not a url")).toBe("unknown");
  });

  it("needs the exact host ticked for an unknown callback", () => {
    expect(callbackVouched("https://evil.example/cb", null)).toBe(false);
    expect(callbackVouched("https://evil.example/cb", "other.example")).toBe(
      false,
    );
    expect(callbackVouched("https://evil.example/cb", "evil.example")).toBe(
      true,
    );
    expect(callbackVouched("https://claude.ai/cb", null)).toBe(true);
    expect(callbackVouched("http://127.0.0.1:1/cb", null)).toBe(true);
  });
});

describe("the token epoch", () => {
  const disconnected = Date.UTC(2026, 10, 27, 12, 0, 0, 500);
  const second = Math.floor(disconnected / 1000);

  it("keeps every token while there is no epoch, iat or not", () => {
    expect(issuedAfterEpoch(undefined, null)).toBe(true);
    expect(issuedAfterEpoch(1, null)).toBe(true);
  });

  it("refuses tokens issued before or at the disconnect, and old ones without iat", () => {
    expect(issuedAfterEpoch(second - 60, disconnected)).toBe(false);
    expect(issuedAfterEpoch(second, disconnected)).toBe(false);
    expect(issuedAfterEpoch(undefined, disconnected)).toBe(false);
  });

  it("accepts tokens issued after it", () => {
    expect(issuedAfterEpoch(second + 1, disconnected)).toBe(true);
  });
});
