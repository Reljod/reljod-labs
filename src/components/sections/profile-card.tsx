import { Icon } from "@/components/ui/icon";
import { Mark } from "@/components/ui/mark";
import { profile } from "@/content/profile";

/** The About hero's aside: Reljod's details, filed like a bank ID card. */
export function ProfileCard() {
  return (
    <aside
      aria-label="Profile"
      className="outline-box bg-paper shadow-hard-lg lg:rotate-1"
    >
      <div className="flex items-center justify-between gap-4 border-ink border-b-2 bg-ink px-6 py-4 text-paper">
        <p className="eyebrow">Reljod Labs · Staff card</p>
        <Mark size={24} />
      </div>
      <dl className="grid gap-5 p-6 sm:grid-cols-2">
        <Field label="Name" value={profile.name} wide />
        <Field label="Role" value={profile.title} />
        <Field label="Focus" value={profile.focus} />
        <Field label="Based in" value={profile.location} wide />
      </dl>
      <div className="flex flex-wrap gap-x-6 gap-y-3 border-ink border-t-2 bg-morning-haze px-6 py-4">
        <a
          href={`mailto:${profile.email}`}
          className="eyebrow inline-flex items-center gap-2 font-bold text-federal-blue hover:underline"
        >
          <Icon name="mail" size={16} />
          {profile.email}
        </a>
        {profile.links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="eyebrow font-bold text-federal-blue hover:underline"
          >
            {link.label}
          </a>
        ))}
      </div>
    </aside>
  );
}

function Field({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="eyebrow text-ink-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}
