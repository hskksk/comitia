import { CollapsibleMarkdown } from "./CollapsibleMarkdown.js";
import { MarkdownBody } from "./MarkdownBody.js";

export function SynthesisCard(props: {
  synthesis: { body: string } | null;
  candidate: { versionNumber: number; content: string } | null;
  /** When true, long candidate content collapses (queue cards). */
  collapseCandidate?: boolean;
}) {
  return (
    <div className="queue-section">
      <h3>争点要約</h3>
      {props.synthesis ? (
        <MarkdownBody source={props.synthesis.body} />
      ) : (
        <p className="muted">争点要約はまだありません</p>
      )}
      <h3>
        {props.candidate
          ? `候補提案 v${props.candidate.versionNumber}`
          : "候補提案"}
      </h3>
      {props.candidate ? (
        props.collapseCandidate ? (
          <CollapsibleMarkdown source={props.candidate.content} />
        ) : (
          <MarkdownBody source={props.candidate.content} />
        )
      ) : (
        <p className="muted">候補は未選定です</p>
      )}
    </div>
  );
}
