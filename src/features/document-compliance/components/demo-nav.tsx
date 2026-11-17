import { DemoBar } from "@/components/demo/demo-bar";

const BASE = "/demos/document-compliance";

const ITEMS = [
  { id: "packs", label: "Packs", href: BASE },
  { id: "rules", label: "Rules", href: `${BASE}/rules` },
  { id: "audit", label: "Audit trail", href: `${BASE}/audit` },
] as const;

export type DemoSection = (typeof ITEMS)[number]["id"];

/** The demo's bar: run a pack, edit the Rules, read the Audit trail. */
export function ComplianceBar({ current }: { current?: DemoSection }) {
  return (
    <DemoBar
      slug="document-compliance-checks"
      name="Document compliance"
      current={current}
      tabs={ITEMS.map((item) => ({
        ...item,
        testId: `demo-nav-${item.id}`,
      }))}
    />
  );
}

/** The heading every page of the demo shares, under the bar. */
export function DemoHeader({ title }: { title: string }) {
  return (
    <header>
      <h1 className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-[2.5rem]">
        {title}
      </h1>
    </header>
  );
}
