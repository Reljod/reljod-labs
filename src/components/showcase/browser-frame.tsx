import type { ReactNode } from "react";

/** A Colonnade browser window around a demo preview, with the demo's address in the bar. */
export function BrowserFrame({
  address,
  children,
}: {
  address: string;
  children: ReactNode;
}) {
  return (
    <div className="outline-box overflow-hidden bg-paper shadow-hard-md transition-[translate,box-shadow] duration-200 group-hover:-translate-x-1 group-hover:-translate-y-1 group-hover:shadow-hard-lg">
      <div className="flex items-center gap-3 border-ink border-b-2 bg-ink px-3 py-2">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 bg-seal-red" />
          <span className="size-2.5 bg-brass" />
          <span className="size-2.5 bg-ivy" />
        </span>
        <span className="eyebrow min-w-0 flex-1 truncate rounded-sm bg-paper/10 px-2 py-0.5 text-[0.6875rem] text-marble normal-case">
          reljod.com{address}
        </span>
      </div>
      {children}
    </div>
  );
}
