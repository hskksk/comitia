import { PERSONALITY_MAX_LENGTH } from "@comitia/shared/constants";
import { PersonalityExamples } from "./PersonalityExamples.js";

export function PersonalityField({
  value,
  onChange,
  showExamples = true,
}: {
  value: string;
  onChange: (value: string) => void;
  showExamples?: boolean;
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
      {showExamples ? (
        <PersonalityExamples
          heading="性格の例"
          headingLevel="h3"
          onApply={onChange}
          appliedBody={value}
        />
      ) : null}
    </div>
  );
}
