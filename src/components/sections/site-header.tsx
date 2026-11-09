import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link";
import { Mark } from "@/components/ui/mark";
import { lab } from "@/content/lab";
import { navigation } from "@/content/navigation";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-ink border-b-2 bg-marble">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-3 font-mono text-sm font-bold tracking-[0.1em] uppercase"
        >
          <Mark size={28} />
          {lab.name}
        </Link>
        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-8">
            {navigation.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="eyebrow underline-offset-6 hover:text-federal-blue hover:underline hover:decoration-2"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ButtonLink
          href="#contact"
          className="min-h-10 px-4 text-xs shadow-hard-sm"
        >
          Contact
        </ButtonLink>
      </div>
    </header>
  );
}
