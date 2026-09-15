import { PERSONALITY_PRESETS } from "@comitia/shared/constants";

export function PersonalityExamples({
  onApply,
  appliedBody,
  heading = "性格の例",
  headingLevel = "h3",
}: {
  onApply?: (body: string) => void;
  appliedBody?: string;
  heading?: string;
  headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;
  const headingId = `${headingLevel}-${heading}`;
  return (
    <section className="personality-examples" aria-labelledby={headingId}>
      <Heading id={headingId}>{heading}</Heading>
      <ul className="personality-example-list">
        {PERSONALITY_PRESETS.map((preset) => (
          <li key={preset.id} className="personality-example-item">
            <p>
              <strong>{preset.id}</strong>
            </p>
            <p className="personality-example-body">{preset.body}</p>
            {onApply ? (
              <button
                type="button"
                className="btn-secondary"
                aria-label={`${preset.id}の文を入れる`}
                aria-pressed={appliedBody === preset.body}
                onClick={() => onApply(preset.body)}
              >
                この文を入れる
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
