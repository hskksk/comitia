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
}) {
  return (
    <div className="badge-row">
      <span className="badge badge-type">{threadTypeLabel(props.type)}</span>
      <span className="badge badge-state">{threadStateLabel(props.state)}</span>
      <span className="badge badge-consensus">
        {consensusTypeLabel(props.consensusType)}
      </span>
    </div>
  );
}

export function PostTypeBadge(props: { type: string }) {
  return <span className="badge badge-post">{postTypeLabel(props.type)}</span>;
}
