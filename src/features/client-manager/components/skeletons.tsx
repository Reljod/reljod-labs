/**
 * Loading shapes for each part of the Client Manager, in the demo's shimmer,
 * sized like what replaces them so nothing moves when data lands. Each region
 * says it is busy and announces what it is loading.
 */

export const delay = (index: number) => ({
  animationDelay: `${index * 0.1}s`,
});

function Loading({ what }: { what: string }) {
  return (
    <output aria-live="polite" className="sr-only">
      Loading {what}…
    </output>
  );
}

/** The Profile's shape: four headline numbers, then its sections. */
export function ProfileSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4 p-6">
      <Loading what="the profile" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="cm-shimmer h-20 rounded-sm"
            style={delay(index)}
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="cm-shimmer h-40 rounded-sm"
            style={delay(index + 4)}
          />
        ))}
      </div>
    </div>
  );
}

/** The Map's shape: the Category tree on the left, the canvas beside it. */
export function MapSkeleton() {
  return (
    <div
      aria-busy="true"
      className="grid h-full min-h-0 md:grid-cols-[14rem_minmax(0,1fr)]"
    >
      <Loading what="the map" />
      <div className="hidden space-y-1.5 border-ink border-r-2 p-2 md:block">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <div
            key={index}
            className="cm-shimmer h-7 rounded-sm"
            style={delay(index)}
          />
        ))}
      </div>
      <div className="relative grid min-h-[24rem] place-items-center">
        <div className="cm-shimmer size-24 rounded-full" />
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div
            key={index}
            className="cm-shimmer absolute size-10 rounded-full"
            style={{
              ...delay(index),
              left: `${50 + 30 * Math.cos((index / 6) * 2 * Math.PI)}%`,
              top: `${50 + 30 * Math.sin((index / 6) * 2 * Math.PI)}%`,
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** One Document's shape: its title, lines of text, and the facts beside it. */
export function DocumentSkeleton() {
  return (
    <div
      aria-busy="true"
      className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_16rem]"
    >
      <Loading what="the document" />
      <div className="space-y-3 p-4 sm:p-6">
        <div className="cm-shimmer mb-5 h-7 w-1/2 rounded-sm" />
        {["w-full", "w-11/12", "w-full", "w-4/5", "w-full", "w-3/5"].map(
          (width, index) => (
            <div
              key={width + String(index)}
              className={`cm-shimmer h-4 rounded-sm ${width}`}
              style={delay(index)}
            />
          ),
        )}
      </div>
      <div className="hidden space-y-1.5 border-ink border-l-2 bg-marble/50 p-2 lg:block">
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            key={index}
            className="cm-shimmer h-9 rounded-sm"
            style={delay(index)}
          />
        ))}
      </div>
    </div>
  );
}

/** A Thread's shape while it opens: a question, then an answer. */
export function MessagesSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6"
    >
      <Loading what="the chat" />
      {[0, 1].map((turn) => (
        <div key={turn} className="space-y-3">
          <div
            className="cm-shimmer ml-auto h-10 w-2/5 rounded-sm"
            style={delay(turn * 4)}
          />
          {["w-11/12", "w-4/5", "w-3/5"].map((width, index) => (
            <div
              key={width}
              className={`cm-shimmer h-4 rounded-sm ${width}`}
              style={delay(turn * 4 + index + 1)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
