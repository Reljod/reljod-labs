import { DemoBar } from "@/components/demo/demo-bar";
import "./client-manager.css";
import { delay, ProfileSkeleton } from "./skeletons";

/**
 * The page while the server reads the first screen: the bar, the list on the
 * left and the open pane, in the places the real ones land, so nothing moves.
 */
export function AppSkeleton({ view }: { view: "chat" | "client" }) {
  return (
    <div aria-busy="true" className="flex h-dvh flex-col bg-marble text-ink">
      <DemoBar slug="client-manager" name="Client Manager" titleAs="h1" />
      <output aria-live="polite" className="sr-only">
        Loading Client Manager…
      </output>
      <div className="flex min-h-0 flex-1">
        <aside
          className={`hidden shrink-0 flex-col gap-2 border-ink border-r-2 p-3 lg:flex ${view === "chat" ? "w-64" : "w-80"}`}
        >
          <div className="cm-shimmer h-8 rounded-sm" />
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div
              key={index}
              className={`cm-shimmer rounded-sm ${view === "chat" ? "h-7" : "h-16"}`}
              style={delay(index)}
            />
          ))}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {view === "chat" ? <ChatSkeleton /> : <ClientFileSkeleton />}
        </main>
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <>
      <div className="h-12 border-ink border-b-2 bg-paper" />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-6">
        <div className="cm-shimmer ml-auto h-10 w-2/5 rounded-sm" />
        <div className="space-y-2">
          <div className="cm-shimmer h-4 w-11/12 rounded-sm" style={delay(1)} />
          <div className="cm-shimmer h-4 w-4/5 rounded-sm" style={delay(2)} />
          <div className="cm-shimmer h-4 w-3/5 rounded-sm" style={delay(3)} />
        </div>
      </div>
      <div className="border-ink border-t-2 bg-paper p-3">
        <div className="cm-shimmer h-12 rounded-sm" />
      </div>
    </>
  );
}

function ClientFileSkeleton() {
  return (
    <>
      <div className="border-ink border-b-2 bg-paper px-4 pt-3 pb-3">
        <div className="flex items-center gap-3">
          <div className="cm-shimmer size-10 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="cm-shimmer h-5 w-48 rounded-sm" />
            <div className="cm-shimmer h-3.5 w-72 max-w-full rounded-sm" />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="cm-shimmer h-8 w-24 rounded-sm"
              style={delay(index)}
            />
          ))}
        </div>
      </div>
      <ProfileSkeleton />
    </>
  );
}
