import { PRESET_QUESTIONS } from "../domain/presets";

export function PresetChips({
  onPick,
  disabled,
}: {
  onPick: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {PRESET_QUESTIONS.map((question) => (
        <li key={question}>
          <button
            type="button"
            data-testid="preset-chip"
            disabled={disabled}
            onClick={() => onPick(question)}
            className="outline-box min-h-9 rounded-sm bg-marble px-3 text-left text-sm transition-colors hover:bg-morning-haze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue disabled:opacity-50"
          >
            {question}
          </button>
        </li>
      ))}
    </ul>
  );
}
