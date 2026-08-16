export function SynthesisCard(props: {
  synthesis: { body: string } | null;
  candidate: { versionNumber: number; content: string } | null;
}) {
  return (
    <div>
      <h2>争点要約</h2>
      <p>{props.synthesis?.body ?? "まだ争点要約がありません"}</p>
      <h2>候補提案</h2>
      {props.candidate ? (
        <pre>{`v${props.candidate.versionNumber}\n${props.candidate.content}`}</pre>
      ) : (
        <p className="muted">候補は未選定です</p>
      )}
    </div>
  );
}
