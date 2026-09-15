import type {
  DeclarationKind,
  ParticipantKind,
  PostType,
  PullRequestState,
  Role,
  ThreadType,
} from "./constants.js";

export const DASHBOARD_ACTIVITY_KINDS = [
  "thread_created",
  "post_added",
  "proposal_added",
  "proposal_version_added",
  "objection_resolved",
  "thread_declaration",
  "work_claimed",
  "work_released",
  "pull_request_linked",
  "pull_request_synced",
  "agreement_superseded",
  "proposal_archived",
  "thread_archived",
  "project_created",
  "project_updated",
  "project_membership_added",
  "project_membership_removed",
  "project_invite_created",
  "role_assigned",
  "github_installation_connected",
  "github_issue_redirected",
  "goals_set",
  "session_ended",
  "session_interrupted",
] as const;

export type DashboardActivityKind =
  (typeof DASHBOARD_ACTIVITY_KINDS)[number];

export type ActivityActor = {
  id: string;
  displayName: string;
  kind: ParticipantKind;
};

export type ActivitySubject =
  | { type: "thread"; id: string; title: string; href: string }
  | { type: "project"; id: string; name: string; href: string }
  | {
      type: "unavailable";
      label: "対象を確認できません";
      href: null;
    };

type ThreadDetail = {
  type: "thread";
  threadType: ThreadType | null;
  preview: string | null;
};

type PostDetail = {
  type: "post";
  postId: string | null;
  postType: PostType | null;
  preview: string | null;
};

type ProposalDetail = {
  type: "proposal";
  proposalId: string | null;
  number: number | null;
  versionNumber: number | null;
  preview: string | null;
};

type ObjectionDetail = {
  type: "objection";
  postId: string | null;
  preview: string | null;
};

type DeclarationDetail = {
  type: "declaration";
  declarationKind: DeclarationKind | null;
  proposalId: string | null;
  proposalNumber: number | null;
  versionNumber: number | null;
  summary: string | null;
  reason: string | null;
  hours: number | null;
};

type WorkDetail = {
  type: "work";
  paths: string[];
  pathCount: number;
};

type PullRequestDetail = {
  type: "pullRequest";
  number: number | null;
  title: string | null;
  state: PullRequestState | null;
  fromState: PullRequestState | null;
  externalUrl: string | null;
};

type AgreementDetail = {
  type: "agreement";
  summary: string | null;
};

type ProjectDetail = {
  type: "project";
  name: string | null;
  repoUrl: string | null;
};

type MembershipDetail = {
  type: "membership";
  participantId: string | null;
  displayName: string | null;
  participantKind: ParticipantKind | null;
};

type RoleDetail = {
  type: "role";
  participantId: string | null;
  displayName: string | null;
  role: Role | null;
};

type RepositoryDetail = {
  type: "repository";
  owner: string | null;
  repo: string | null;
  externalUrl: string | null;
};

type IssueDetail = {
  type: "issue";
  number: number | null;
  externalUrl: string | null;
};

type SessionDetail = {
  type: "session";
  sessionId: string | null;
  participantId: string | null;
  displayName: string | null;
};

export type ActivityDetailByKind = {
  thread_created: ThreadDetail;
  post_added: PostDetail;
  proposal_added: ProposalDetail;
  proposal_version_added: ProposalDetail;
  objection_resolved: ObjectionDetail;
  thread_declaration: DeclarationDetail;
  work_claimed: WorkDetail;
  work_released: WorkDetail;
  pull_request_linked: PullRequestDetail;
  pull_request_synced: PullRequestDetail;
  agreement_superseded: AgreementDetail;
  proposal_archived: ProposalDetail;
  thread_archived: {
    type: "thread";
    threadType: null;
    preview: null;
  };
  project_created: ProjectDetail;
  project_updated: ProjectDetail;
  project_membership_added: MembershipDetail;
  project_membership_removed: MembershipDetail;
  project_invite_created: { type: "invite" };
  role_assigned: RoleDetail;
  github_installation_connected: RepositoryDetail;
  github_issue_redirected: IssueDetail;
  goals_set: { type: "goals"; goalCount: number | null };
  session_ended: SessionDetail;
  session_interrupted: SessionDetail;
};

type ActivityItemFor<K extends DashboardActivityKind> = {
  id: number;
  kind: K;
  actor: ActivityActor | null;
  subject: ActivitySubject;
  detail: ActivityDetailByKind[K];
  createdAt: string;
};

export type ActivityItem = {
  [K in DashboardActivityKind]: ActivityItemFor<K>;
}[DashboardActivityKind];
