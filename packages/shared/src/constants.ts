/** スレッド型 */
export const THREAD_TYPES = [
  "consultation",
  "proposal",
  "implementation",
  "review",
  "brainstorm",
] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];

/** スレッド状態 */
export const THREAD_STATES = [
  "discussing",
  "awaiting_decision",
  "decided",
  "rejected",
  "completed",
] as const;
export type ThreadState = (typeof THREAD_STATES)[number];

/** 投稿型 */
export const POST_TYPES = [
  "proposal",
  "position",
  "synthesis",
  "question",
  "objection",
  "approval",
  "declaration",
  "report",
  "comment",
] as const;
export type PostType = (typeof POST_TYPES)[number];

/** 合意種類 */
export const CONSENSUS_TYPES = [
  "rough",
  "human_ratification",
  "owner_decision",
  "unanimous",
  "no_objection",
  "silence",
] as const;
export type ConsensusType = (typeof CONSENSUS_TYPES)[number];

/** エンジン多様性（unanimous のみ有効。他種類は no-op） */
export const ENGINE_DIVERSITY = [
  "off",
  "collapse_same_engine",
  "require_other_engine",
] as const;
export type EngineDiversity = (typeof ENGINE_DIVERSITY)[number];

/** 提案スレッドの対象 */
export const PROPOSAL_TARGETS = ["repo_artifact", "shared_artifact"] as const;
export type ProposalTarget = (typeof PROPOSAL_TARGETS)[number];

/** 共有物の種類 */
export const SHARED_ARTIFACT_KINDS = [
  "project_rule",
  "thread_template",
  "skill",
] as const;
export type SharedArtifactKind = (typeof SHARED_ARTIFACT_KINDS)[number];

/** 宣言の種類 */
export const DECLARATION_KINDS = [
  "select_candidate",
  "declare_rough",
  "owner_decide",
  "request_ratification",
  "ratify",
  "send_back",
  "reject_thread",
  "complete_thread",
  "resolve_objection",
  "extend_window",
  "shorten_window",
  "clock_satisfy",
] as const;
export type DeclarationKind = (typeof DECLARATION_KINDS)[number];

/** Declarations the human UI may issue. */
export const HUMAN_DECLARATION_KINDS = [
  "ratify",
  "send_back",
  "reject_thread",
  "complete_thread",
] as const;
export type HumanDeclarationKind = (typeof HUMAN_DECLARATION_KINDS)[number];

export const PULL_REQUEST_STATES = ["open", "merged", "closed"] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

/** 合意物の帰結 */
export const AGREEMENT_OUTCOMES = ["adopted", "rejected"] as const;
export type AgreementOutcome = (typeof AGREEMENT_OUTCOMES)[number];

/** 合意物の状態 */
export const AGREEMENT_STATES = ["active", "superseded", "revoked"] as const;
export type AgreementState = (typeof AGREEMENT_STATES)[number];

/** 提案の帰結 */
export const PROPOSAL_OUTCOMES = [
  "open",
  "adopted",
  "rejected",
  "withdrawn",
] as const;
export type ProposalOutcome = (typeof PROPOSAL_OUTCOMES)[number];

/** ロール */
export const ROLES = [
  "facilitator",
  "proposer",
  "reviewer",
  "recorder",
  "executor",
] as const;
export type Role = (typeof ROLES)[number];

/** 参加者の種類 */
export const PARTICIPANT_KINDS = ["human", "agent", "system"] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

/** Engines the board will register. `fake` is a human-driven walkthrough, not a coding CLI. */
export const ENGINES = ["claude-code", "fake"] as const;
export type Engine = (typeof ENGINES)[number];

/** Agent discussion attitude (M15). Counted in Unicode code points. */
export const PERSONALITY_MAX_LENGTH = 200;

export * from "./personality-presets.js";

export function isSupportedEngine(value: string): value is Engine {
  return (ENGINES as readonly string[]).includes(value);
}

/** Default session activity budget (M2). */
export const DEFAULT_SESSION_BUDGET = 1000;

/** Budget reserved for wind-down; only end_session is allowed once remaining <= this. */
export const WIND_DOWN_RESERVE = 10;

/** Gateway timing and capacity limits (M3). */
export const GATEWAY = {
  digestTimeoutMs: 60_000,
  sessionTimeoutMs: 60 * 60_000,
  healthPingMs: 30_000,
  healthTtlMs: 90_000,
  idleRunLimit: 2,
  maxRuns: 8,
  /** Extra runs allowed after wind-down starts so end_session can succeed. */
  windDownRunLimit: 3,
  defaultListenPort: 8787,
} as const;

/** Explicit per-tool costs; mutating tools default to DEFAULT_MUTATING_TOOL_COST. */
export const TOOL_COSTS = {
  get_briefing: 0,
  use_project: 0,
  read_thread: 3,
  search_threads: 0,
  search_decisions: 0,
  list_work_claims: 0,
  search_notes: 0,
  read_note: 3,
  list_system_templates: 0,
} as const;

export const DEFAULT_MUTATING_TOOL_COST = 5;

export function getToolCost(toolName: string): number {
  if (toolName in TOOL_COSTS) {
    return TOOL_COSTS[toolName as keyof typeof TOOL_COSTS];
  }
  return DEFAULT_MUTATING_TOOL_COST;
}

/** イベント種別 */
export const EVENT_KINDS = [
  "participant_registered",
  "project_created",
  "role_assigned",
  "thread_created",
  "proposal_added",
  "proposal_version_added",
  "post_added",
  "objection_resolved",
  "candidate_selected",
  "state_changed",
  "agreement_recorded",
  "agreement_superseded",
  "thread_declaration",
  "session_started",
  "session_ended",
  "session_digested",
  "session_interrupted",
  "tick_queued",
  "tick_delivered",
  "agent_connected",
  "agent_disconnected",
  "goals_set",
  "budget_spent",
  "pull_request_linked",
  "pull_request_synced",
  "github_issue_redirected",
  "github_installation_connected",
  "github_owner_bound",
  "work_claimed",
  "work_released",
  "project_membership_added",
  "project_membership_removed",
  "project_invite_created",
  "project_updated",
  "thread_archived",
  "proposal_archived",
  "agent_updated",
  "agent_archived",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
