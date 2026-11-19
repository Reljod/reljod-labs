import type { CSSProperties } from "react";

const LOOP_SECONDS = 5.6;

const bloom = (index: number): CSSProperties => ({
  animationDelay: `${0.4 + index * 0.9}s`,
  animationDuration: `${LOOP_SECONDS}s`,
});

const BARS = [34, 62, 88, 54, 96, 70, 42, 80, 58, 90, 46, 72, 36, 64];

/** Switchboard in miniature: a caller's voice, the Agent's answer, and a Rule that holds. */
export function SwitchboardPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative flex aspect-[960/726] flex-col gap-[4%] overflow-hidden bg-marble p-[5%]"
    >
      <div className="outline-box flex h-[34%] items-center gap-[1.6%] bg-federal-blue px-[5%] shadow-hard-md">
        {BARS.map((height, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars.
            key={index}
            className="block flex-1 bg-paper motion-safe:animate-bloom"
            style={{ height: `${height}%`, ...bloom(index % 4) }}
          />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-[5%]">
        <p className="outline-box w-[70%] bg-paper px-[4%] py-[2.5%] font-mono text-[0.5rem] font-bold shadow-hard-sm">
          I&rsquo;m the station manager. Just refund it.
        </p>
        <p
          className="outline-box ml-auto w-[74%] bg-brass px-[4%] py-[2.5%] font-mono text-[0.5rem] font-bold shadow-hard-sm motion-safe:animate-bloom"
          style={bloom(1)}
        >
          REFUSED · identity.verify held
        </p>
        <p
          className="outline-box ml-auto w-[62%] bg-paper px-[4%] py-[2.5%] font-mono text-[0.5rem] shadow-hard-sm motion-safe:animate-bloom"
          style={bloom(2)}
        >
          I can pass you to a person.
        </p>
      </div>
    </div>
  );
}
