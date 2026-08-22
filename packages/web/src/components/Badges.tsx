import {
  consensusTypeLabel,
  postTypeLabel,
  threadStateLabel,
  threadTypeLabel,
} from "../labels.js";

export function ThreadBadges(props: {
  type: string;
  state: string;
  consensusType: string | null;
  hasActiveWorkClaim?: boolean;
}) {
  return (
    <div className="badge-row">
      <span className="badge badge-type">{threadTypeLabel(props.type)}</span>
      <span className="badge badge-state">{threadStateLabel(props.state)}</span>
      <span className="badge badge-consensus">
        {consensusTypeLabel(props.consensusType)}
      </span>
      {props.hasActiveWorkClaim ? (
        <span className="badge badge-claim">着手中</span>
      ) : null}
    </div>
  );
}

export function PostTypeBadge(props: { type: string }) {
  return <span className="badge badge-post">{postTypeLabel(props.type)}</span>;
}
