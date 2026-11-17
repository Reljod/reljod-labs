import Link from "next/link";

const BASE = "/demos/document-compliance";

const ITEMS = [
  { id: "packs", label: "Packs", href: BASE },
  { id: "rules", label: "Rules", href: `${BASE}/rules` },
  { id: "audit", label: "Audit trail", href: `${BASE}/audit` },
] as const;

export type DemoSection = (typeof ITEMS)[number]["id"];

/** The demo's three places: run a pack, edit the Rules, read the Audit trail. */
export function DemoNav({ current }: { current: DemoSection }) {
  return (
    <nav aria-label="Document compliance" className="flex flex-wrap gap-2">
      {ITEMS.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          data-testid={`demo-nav-${item.id}`}
          aria-current={item.id === current ? "page" : undefined}
          className={`outline-box press eyebrow rounded-sm px-3 py-2 ${
            item.id === current ? "bg-ink text-paper" : "bg-paper"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** The heading every page of the demo shares. */
export function DemoHeader({
  current,
  title,
}: {
  current: DemoSection;
  title: string;
}) {
  return (
    <header className="flex flex-col gap-3">
      <Link href="/" className="eyebrow text-federal-blue underline">
        ← Reljod Labs
      </Link>
      <h1 className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-[2.5rem]">
        {title}
      </h1>
      <DemoNav current={current} />
    </header>
  );
}
