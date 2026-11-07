/** The two things every visitor must know, on every demo screen. */
export function Caveats() {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-1 border-ink/20 border-t pt-4 text-sm text-ink-muted">
      <li>
        Specimen documents from the fictional Republic of Meridia. No real
        person, issuer or document design is shown.
      </li>
      <li>A Pre-screen never approves or rejects; a person decides.</li>
    </ul>
  );
}
