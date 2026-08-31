import { PERSONALITY_MAX_LENGTH, PERSONALITY_PRESETS } from "@comitia/shared/constants";

export function PersonalityField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="personality-field">
      <label>
        性格（任意）
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={PERSONALITY_MAX_LENGTH}
          rows={3}
          placeholder="例: 慎重にリスクを先に出す"
        />
      </label>
      <div className="personality-presets" role="group" aria-label="性格の例">
        {PERSONALITY_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="btn-secondary"
            aria-pressed={value === preset.body}
            onClick={() => onChange(preset.body)}
          >
            {preset.id}
          </button>
        ))}
      </div>
    </div>
  );
}
