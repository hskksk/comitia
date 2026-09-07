import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ActivityItem, ActivitySubject } from "../api.js";
import {
  declarationKindLabel,
  postTypeLabel,
  pullRequestStateLabel,
  roleLabel,
} from "../labels.js";
import { formatRelativeTimeJa } from "../relativeTime.js";

type ActivitySentence =
  | { prefix: string; suffix: string }
  | { plain: string };

function subjectLabel(subject: ActivitySubject): string {
  if (subject.type === "thread") return subject.title;
  if (subject.type === "project") return subject.name;
  return subject.label;
}

function SubjectLink({ subject }: { subject: ActivitySubject }) {
  const label = subjectLabel(subject);
  return subject.href ? <Link to={subject.href}>{label}</Link> : <span>{label}</span>;
}

function actorLabel(item: ActivityItem): string {
  if (item.actor) return item.actor.displayName;
  if (
    item.kind === "pull_request_synced" ||
    item.kind === "github_issue_redirected"
  ) {
    return "GitHub";
  }
  return "システム";
}

function proposalNumber(number: number | null): string {
  return number === null ? "提案" : `提案 #${number}`;
}

function activitySentence(item: ActivityItem): ActivitySentence {
  const actor = actorLabel(item);
  switch (item.kind) {
    case "thread_created":
      return { prefix: `${actor}が「`, suffix: "」を作成" };
    case "post_added": {
      const postType = item.detail.postType
        ? postTypeLabel(item.detail.postType)
        : "投稿";
      return {
        prefix: `${actor}が「`,
        suffix: `」に${postType}を投稿`,
      };
    }
    case "proposal_added":
      return {
        prefix: `${actor}が「`,
        suffix: `」に${proposalNumber(item.detail.number)}を追加`,
      };
    case "proposal_version_added":
      return {
        prefix: `${actor}が「`,
        suffix: `」の${proposalNumber(item.detail.number)}を${
          item.detail.versionNumber === null
            ? "更新"
            : `第${item.detail.versionNumber}版に更新`
        }`,
      };
    case "objection_resolved":
      return { prefix: `${actor}が「`, suffix: "」の異議を解消" };
    case "thread_declaration":
      return {
        prefix: `${actor}が「`,
        suffix: `」で${
          item.detail.declarationKind
            ? declarationKindLabel(item.detail.declarationKind)
            : "変更"
        }を宣言`,
      };
    case "work_claimed":
      return { prefix: `${actor}が「`, suffix: "」の作業に着手" };
    case "work_released":
      return { prefix: `${actor}が「`, suffix: "」の作業を手放した" };
    case "pull_request_linked":
      return {
        prefix: `${actor}が「`,
        suffix: `」に${
          item.detail.number === null ? "PR" : `PR #${item.detail.number}`
        }をリンク`,
      };
    case "pull_request_synced":
      return {
        prefix: `${actor}で「`,
        suffix: `」の${
          item.detail.number === null ? "PR" : `PR #${item.detail.number}`
        }が${
          item.detail.state
            ? pullRequestStateLabel(item.detail.state)
            : "新しい状態"
        }に更新`,
      };
    case "agreement_superseded":
      return { prefix: `${actor}が「`, suffix: "」の合意を置き換え" };
    case "proposal_archived":
      return {
        prefix: `${actor}が「`,
        suffix: `」の${proposalNumber(item.detail.number)}を削除`,
      };
    case "thread_archived":
      return { prefix: `${actor}が「`, suffix: "」を削除" };
    case "project_created":
      return { prefix: `${actor}が「`, suffix: "」を作成" };
    case "project_updated":
      return { prefix: `${actor}が「`, suffix: "」の設定を更新" };
    case "project_membership_added":
      return {
        prefix: `${actor}が${item.detail.displayName ?? "対象の参加者"}を「`,
        suffix: "」に追加",
      };
    case "project_membership_removed":
      return {
        prefix: `${actor}が${item.detail.displayName ?? "対象の参加者"}を「`,
        suffix: "」から削除",
      };
    case "project_invite_created":
      return { prefix: `${actor}が「`, suffix: "」への招待を作成" };
    case "role_assigned":
      return {
        prefix: `${actor}が${item.detail.displayName ?? "対象の参加者"}に${
          item.detail.role ? roleLabel(item.detail.role) : "ロール"
        }を割り当て（「`,
        suffix: "」）",
      };
    case "github_installation_connected":
      return { prefix: `${actor}が「`, suffix: "」にGitHubを接続" };
    case "github_issue_redirected":
      return {
        prefix: `${actor}が${
          item.detail.number === null
            ? "Issueを"
            : `Issue #${item.detail.number}を`
        }「`,
        suffix: "」へ案内",
      };
    case "goals_set":
      return {
        prefix: `${actor}が「`,
        suffix: `」で今日の目標を${
          item.detail.goalCount === null ? "" : `${item.detail.goalCount}件`
        }設定`,
      };
    case "session_ended":
      return { prefix: `${actor}が「`, suffix: "」で一日を終了" };
    case "session_interrupted":
      return {
        prefix: `${item.detail.displayName ?? "エージェント"}の一日が「`,
        suffix: "」で中断",
      };
    default:
      return { plain: "プロジェクトが更新されました" };
  }
}

function pullRequestDetail(
  detail: Extract<ActivityItem, { kind: "pull_request_linked" }>["detail"],
): ReactNode {
  const label =
    detail.title ??
    (detail.number === null ? "GitHubで確認" : `PR #${detail.number}`);
  return detail.externalUrl ? (
    <a href={detail.externalUrl} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    label
  );
}

function activityDetail(item: ActivityItem): ReactNode {
  const detail = item.detail;
  switch (detail.type) {
    case "thread":
    case "post":
    case "objection":
      return detail.preview;
    case "proposal":
      return detail.preview;
    case "declaration":
      if (detail.summary) return detail.summary;
      if (detail.reason) return `理由: ${detail.reason}`;
      if (detail.proposalNumber !== null) {
        return `${proposalNumber(detail.proposalNumber)}${
          detail.versionNumber === null ? "" : ` 第${detail.versionNumber}版`
        }`;
      }
      if (detail.hours !== null) return `${detail.hours}時間`;
      return null;
    case "work": {
      const visible = detail.paths.join("、");
      const rest = detail.pathCount - detail.paths.length;
      return `${visible}${rest > 0 ? `、ほか${rest}件` : ""}`;
    }
    case "pullRequest":
      return pullRequestDetail(detail);
    case "agreement":
      return detail.summary;
    case "project":
      return detail.repoUrl ? "リポジトリ設定あり" : null;
    case "repository": {
      const label =
        detail.owner && detail.repo
          ? `${detail.owner}/${detail.repo}`
          : "GitHubリポジトリ";
      return detail.externalUrl ? (
        <a href={detail.externalUrl} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        label
      );
    }
    case "issue": {
      if (!detail.externalUrl) return null;
      return (
        <a href={detail.externalUrl} target="_blank" rel="noreferrer">
          {detail.number === null ? "Issueを開く" : `Issue #${detail.number}`}
        </a>
      );
    }
    case "membership":
    case "invite":
    case "role":
    case "goals":
    case "session":
      return null;
  }
}

export function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <ul className="activity-list">
      {items.map((item) => {
        const sentence = activitySentence(item);
        const detail = activityDetail(item);
        return (
          <li key={item.id} className="activity-item">
            <div className="activity-copy">
              <p className="activity-main">
                {"plain" in sentence ? (
                  sentence.plain
                ) : (
                  <>
                    {sentence.prefix}
                    <SubjectLink subject={item.subject} />
                    {sentence.suffix}
                  </>
                )}
              </p>
              {detail ? <p className="activity-detail">{detail}</p> : null}
            </div>
            <time className="muted" dateTime={item.createdAt}>
              {formatRelativeTimeJa(item.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
