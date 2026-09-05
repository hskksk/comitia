import {
  consensusTypeLabel,
  postTypeLabel,
  threadStateLabel,
  threadTypeLabel,
  workPhaseLabel,
} from "../labels.js";

export function ThreadBadges(props: {
  type: string;
  state: string;
  consensusType: string | null;
  workPhase?: string | null;
  activeWorkClaimants?: string[];
}) {
  return (
    <div className="badge-row">
      <span className="badge badge-type">{threadTypeLabel(props.type)}</span>
      {props.workPhase ? (
        <span className="badge badge-state">{workPhaseLabel(props.workPhase)}</span>
      ) : null}
      <span className={props.workPhase ? "badge" : "badge badge-state"}>
        {threadStateLabel(props.state)}
      </span>
      <span className="badge badge-consensus">
        {consensusTypeLabel(props.consensusType)}
      </span>
      {props.activeWorkClaimants && props.activeWorkClaimants.length > 0 ? (
        <span className="badge badge-work-claim">
          着手中: {props.activeWorkClaimants.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

export function PostTypeBadge(props: { type: string }) {
  return <span className="badge badge-post">{postTypeLabel(props.type)}</span>;
}
