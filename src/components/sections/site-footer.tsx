import { Mark } from "@/components/ui/mark";
import { navigation } from "@/content/navigation";
import { profile } from "@/content/profile";

export function SiteFooter() {
  return (
    <footer className="border-ink border-t-2 bg-oak text-marble">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="flex items-center gap-3 font-mono text-sm font-bold tracking-[0.1em] uppercase">
            <Mark size={28} />
            Reljod Labs
          </p>
          <p className="mt-3 text-sm">
            {profile.name} · {profile.title}
          </p>
          <p className="mt-1 text-sm">{profile.location}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-8 gap-y-3">
            {[...navigation, ...profile.links].map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="eyebrow underline-offset-6 hover:underline hover:decoration-2"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-marble/30 border-t-2">
        <p className="mx-auto max-w-6xl px-4 py-4 text-sm sm:px-6">
          © {profile.name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
