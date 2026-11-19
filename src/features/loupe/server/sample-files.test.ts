import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./storage", () => ({
  download: async () => null,
  samplePath: (id: string, file: string) => `samples/${id}/${file}`,
  upload: async () => {},
}));

import { fetchOrigin } from "./sample-files";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("where a Sample's file may be fetched from", () => {
  it("never sends the bypass secret to a host the request named", () => {
    vi.stubEnv("VERCEL_URL", "loupe-abc.vercel.app");
    vi.stubEnv("VERCEL_BRANCH_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(fetchOrigin("https://evil.example")).toEqual({
      origin: "https://loupe-abc.vercel.app",
      own: true,
    });
    expect(fetchOrigin("https://loupe-abc.vercel.app")).toEqual({
      origin: "https://loupe-abc.vercel.app",
      own: true,
    });
  });

  it("uses a local dev server only outside production, without the secret", () => {
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("VERCEL_BRANCH_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(fetchOrigin("http://localhost:3113")).toEqual({
      origin: "http://localhost:3113",
      own: false,
    });
    expect(fetchOrigin("http://169.254.169.254")).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(fetchOrigin("http://localhost:3113")).toBeNull();
  });
});
