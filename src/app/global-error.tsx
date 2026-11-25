"use client";

import { useEffect } from "react";
import {
  FallbackPanel,
  fallbackActionClass,
  fallbackPrimaryActionClass,
} from "@/components/sections/fallback-panel";
import "./globals.css";

/**
 * Replaces the root layout when the root layout itself throws, so it brings
 * its own <html>, <body> and stylesheet (the fonts are left to the fallback
 * stacks). Metadata exports are not supported here; <title> is.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>Something went wrong</title>
        <FallbackPanel
          eyebrow="Something went wrong"
          title="The site could not be drawn"
          actions={
            <>
              <button
                type="button"
                onClick={() => retry()}
                className={fallbackPrimaryActionClass}
              >
                Try again
              </button>
              {/* A plain link, a full reload: the router may be what failed. */}
              <a href="/" className={fallbackActionClass}>
                Home
              </a>
            </>
          }
        >
          <p>Try again in a moment.</p>
        </FallbackPanel>
      </body>
    </html>
  );
}
