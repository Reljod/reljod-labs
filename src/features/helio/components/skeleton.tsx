import { DemoBar } from "@/components/demo/demo-bar";

/** Shaped Colonnade loading skeleton matching Helio's Studio layout. */
export function HelioSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-marble text-ink">
      <DemoBar slug="helio" name="Helio" titleAs="h1" />
      <main
        aria-busy="true"
        className="mx-auto w-full max-w-[1440px] flex-1 space-y-5 px-4 py-5"
      >
        <p className="sr-only" aria-live="polite">
          Loading Helio studio light table…
        </p>
        <div className="outline-box h-24 animate-pulse rounded-sm bg-[#0d1424]/85" />
        <div className="grid gap-5 lg:grid-cols-[430px_1fr]">
          <div className="outline-box aspect-square animate-pulse rounded-sm bg-limestone/60" />
          <div className="space-y-4">
            <div className="outline-box h-44 animate-pulse rounded-sm bg-paper" />
            <div className="outline-box h-64 animate-pulse rounded-sm bg-[#0d1424]/80" />
          </div>
        </div>
      </main>
    </div>
  );
}
