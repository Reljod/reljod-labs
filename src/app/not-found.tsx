import type { Metadata } from "next";
import Link from "next/link";
import {
  FallbackPanel,
  fallbackActionClass,
  fallbackPrimaryActionClass,
} from "@/components/sections/fallback-panel";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";

export const metadata: Metadata = { title: "Page not found" };

/** Unmatched URLs and every `notFound()` that has no closer `not-found.tsx`. */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <FallbackPanel
        eyebrow="404"
        title="Nothing is filed here"
        actions={
          <>
            <Link href="/demos" className={fallbackPrimaryActionClass}>
              All demos
            </Link>
            <Link href="/" className={fallbackActionClass}>
              Home
            </Link>
          </>
        }
      >
        <p>
          The page you asked for does not exist, or the record it pointed to has
          been removed.
        </p>
      </FallbackPanel>
      <SiteFooter />
    </>
  );
}
