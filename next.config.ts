import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Loaded from node_modules at runtime: tesseract.js starts a worker thread
  // from its own files, and pdf.js loads its worker the same way.
  serverExternalPackages: ["tesseract.js", "pdfjs-dist"],
  // The OAuth consent pages must not be framed, or a click could be stolen.
  async headers() {
    return [
      {
        source: "/demos/client-manager/mcp/authorize",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: "/demos/harness/mcp/authorize",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  // Tesseract's worker thread requires its own files and the WebAssembly core
  // by computed paths, so file tracing misses them and the Pre-screen step
  // fails on Vercel with "Cannot find module". Ship them with the step route.
  outputFileTracingIncludes: {
    "/.well-known/workflow/v1/flow": [
      "./node_modules/.pnpm/tesseract.js@*/node_modules/**/*",
      "./node_modules/.pnpm/tesseract.js-core@*/node_modules/tesseract.js-core/*.{js,wasm}",
      "./node_modules/.pnpm/{bmp-js,wasm-feature-detect,zlibjs}@*/node_modules/**/*",
      "./public/loupe/samples/*/document.*",
    ],
    "/api/loupe/mcp": ["./public/loupe/samples/*/document.*"],
    "/demos/loupe": ["./public/loupe/samples/*/document.*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withWorkflow(nextConfig);
