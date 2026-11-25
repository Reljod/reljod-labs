"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  FallbackPanel,
  fallbackActionClass,
  fallbackPrimaryActionClass,
} from "@/components/sections/fallback-panel";

/**
 * Any page or nested layout that throws while rendering lands here. In
 * production a Server Component's message is replaced by Next with a generic
 * one, so only the digest (which matches the server log) is shown.
 */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : "";

  return (
    <FallbackPanel
      eyebrow="Something went wrong"
      title="This page could not be drawn"
      actions={
        <>
          <button
            type="button"
            onClick={() => retry()}
            className={fallbackPrimaryActionClass}
          >
            Try again
          </button>
          <Link href="/demos" className={fallbackActionClass}>
            All demos
          </Link>
        </>
      }
    >
      <p>
        Something failed while this page was loading. Try again, or go back to
        the demos.
      </p>
      {digest ? <p className="eyebrow mt-4">Reference {digest}</p> : null}
    </FallbackPanel>
  );
}
