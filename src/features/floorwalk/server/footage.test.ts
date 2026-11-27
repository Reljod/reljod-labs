import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./storage", () => ({ download: async () => null }));

import { sampleOrigin } from "./footage";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("where a Sample's footage may be fetched from", () => {
  it("uses this deployment's own address, never a host the request named", () => {
    vi.stubEnv("VERCEL_URL", "floorwalk-abc.vercel.app");
    expect(sampleOrigin("https://evil.example")).toEqual({
      base: "https://floorwalk-abc.vercel.app",
      own: true,
    });
  });

  it("uses a local origin only outside production", () => {
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("VERCEL_BRANCH_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(sampleOrigin("http://localhost:3000")).toEqual({
      base: "http://localhost:3000",
      own: false,
    });
    expect(sampleOrigin("https://evil.example")).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(sampleOrigin("http://localhost:3000")).toBeNull();
  });
});
