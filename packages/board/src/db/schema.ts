import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["human", "agent", "system"] }).notNull(),
    displayName: text("display_name").notNull(),
    ownerParticipantId: uuid("owner_participant_id"),
    engine: text("engine"),
    githubUserId: text("github_user_id"),
    githubLogin: text("github_login"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("participants_github_user_id_uidx").on(table.githubUserId),
  ],
);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  repoUrl: text("repo_url"),
  githubInstallationId: text("github_installation_id"),
  githubOwner: text("github_owner"),
  githubRepo: text("github_repo"),
  ownerParticipantId: uuid("owner_participant_id")
    .notNull()
    .references(() => participants.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projectMemberships = pgTable(
  "project_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.participantId)],
);

export const projectInvites = pgTable("project_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  tokenHash: text("token_hash").notNull().unique(),
  createdByParticipantId: uuid("created_by_participant_id")
    .notNull()
    .references(() => participants.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const githubOauthStates = pgTable("github_oauth_states", {
  state: text("state").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    role: text("role", {
      enum: [
        "facilitator",
        "proposer",
        "reviewer",
        "recorder",
        "executor",
      ],
    }).notNull(),
  },
  (table) => [unique().on(table.projectId, table.participantId, table.role)],
);

export const threads = pgTable("threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  type: text("type", {
    enum: [
      "consultation",
      "proposal",
      "implementation",
      "review",
      "brainstorm",
    ],
  }).notNull(),
  state: text("state", {
    enum: [
      "discussing",
      "awaiting_decision",
      "decided",
      "rejected",
      "completed",
    ],
  })
    .notNull()
    .default("discussing"),
  ownerParticipantId: uuid("owner_participant_id")
    .notNull()
    .references(() => participants.id),
  consensusType: text("consensus_type", {
    enum: [
      "rough",
      "human_ratification",
      "owner_decision",
      "unanimous",
      "no_objection",
      "silence",
    ],
  }),
  humanRequired: boolean("human_required").notNull().default(false),
  target: text("target", { enum: ["repo_artifact", "shared_artifact"] }),
  sharedArtifactKind: text("shared_artifact_kind", {
    enum: ["project_rule", "thread_template", "skill"],
  }),
  title: text("title").notNull(),
  trigger: text("trigger").notNull(),
  duplicateSearchQuery: text("duplicate_search_query").notNull(),
  candidateProposalVersionId: uuid("candidate_proposal_version_id"),
  parentThreadId: uuid("parent_thread_id"),
  awaitingEnteredAt: timestamp("awaiting_entered_at", { withTimezone: true }),
  timingDurationHours: integer("timing_duration_hours"),
  timingEndsAt: timestamp("timing_ends_at", { withTimezone: true }),
  engineDiversity: text("engine_diversity", {
    enum: ["off", "collapse_same_engine", "require_other_engine"],
  })
    .notNull()
    .default("off"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const threadPullRequests = pgTable(
  "thread_pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    state: text("state", { enum: ["open", "merged", "closed"] }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique().on(table.projectId, table.number)],
);

export const workClaims = pgTable("work_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => threads.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),
  paths: jsonb("paths").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
});

export const memories = pgTable("memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
});

export const personalNotes = pgTable("personal_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorParticipantId: uuid("author_participant_id")
    .notNull()
    .references(() => participants.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  format: text("format", { enum: ["file", "journal"] }).notNull(),
  visibility: text("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("public"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const personalNoteComments = pgTable("personal_note_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  noteId: uuid("note_id")
    .notNull()
    .references(() => personalNotes.id),
  authorParticipantId: uuid("author_participant_id")
    .notNull()
    .references(() => participants.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const githubIssueIntakes = pgTable(
  "github_issue_intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    issueNumber: integer("issue_number").notNull(),
    boardThreadId: uuid("board_thread_id")
      .notNull()
      .references(() => threads.id),
    status: text("status", { enum: ["redirected"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.issueNumber)],
);

export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => threads.id),
  number: integer("number").notNull(),
  authorParticipantId: uuid("author_participant_id")
    .notNull()
    .references(() => participants.id),
  outcome: text("outcome", {
    enum: ["open", "adopted", "rejected", "withdrawn"],
  })
    .notNull()
    .default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const proposalVersions = pgTable("proposal_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id),
  versionNumber: integer("version_number").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agreements = pgTable("agreements", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => threads.id),
  proposalVersionId: uuid("proposal_version_id")
    .notNull()
    .references(() => proposalVersions.id),
  outcome: text("outcome", { enum: ["adopted", "rejected"] }).notNull(),
  binding: boolean("binding").notNull(),
  state: text("state", { enum: ["active", "superseded", "revoked"] })
    .notNull()
    .default("active"),
  supersededByAgreementId: uuid("superseded_by_agreement_id"),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const threadConflictCitations = pgTable("thread_conflict_citations", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => threads.id),
  agreementId: uuid("agreement_id")
    .notNull()
    .references(() => agreements.id),
  note: text("note").notNull(),
});

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => threads.id),
  authorParticipantId: uuid("author_participant_id")
    .notNull()
    .references(() => participants.id),
  type: text("type", {
    enum: [
      "proposal",
      "position",
      "synthesis",
      "question",
      "objection",
      "approval",
      "declaration",
      "report",
      "comment",
    ],
  }).notNull(),
  body: text("body").notNull(),
  rationale: text("rationale"),
  blocking: boolean("blocking"),
  proposalVersionId: uuid("proposal_version_id").references(
    () => proposalVersions.id,
  ),
  declarationKind: text("declaration_kind", {
    enum: [
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
    ],
  }),
  declarationPayload: jsonb("declaration_payload"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by"),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    briefingAt: timestamp("briefing_at", { withTimezone: true }),
    endedReason: text("ended_reason", { enum: ["completed", "interrupted"] }),
    chatLog: text("chat_log").notNull().default(""),
    budgetLimit: integer("budget_limit").notNull(),
    budgetUsed: integer("budget_used").notNull().default(0),
    windDownReserved: integer("wind_down_reserved").notNull(),
  },
  (table) => [
    uniqueIndex("sessions_one_open_per_participant_project")
      .on(table.participantId, table.projectId)
      .where(sql`${table.endedAt} is null`),
  ],
);

export const sessionGoals = pgTable("session_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  text: text("text").notNull(),
  status: text("status", { enum: ["pending", "completed"] })
    .notNull()
    .default("pending"),
  sortOrder: integer("sort_order").notNull(),
});

export const handovers = pgTable("handovers", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  body: text("body").notNull(),
});

export const events = pgTable("events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  projectId: uuid("project_id").references(() => projects.id),
  threadId: uuid("thread_id").references(() => threads.id),
  actorParticipantId: uuid("actor_participant_id").references(
    () => participants.id,
  ),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agentCredentials = pgTable("agent_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id)
    .unique(),
  projectId: uuid("project_id").references(() => projects.id),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const agentConnections = pgTable("agent_connections", {
  participantId: uuid("participant_id")
    .primaryKey()
    .references(() => participants.id),
  status: text("status", { enum: ["connected", "disconnected"] })
    .notNull()
    .default("disconnected"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  sessionStartMinute: integer("session_start_minute").notNull().default(0),
});

export const ticks = pgTable(
  "ticks",
  {
    id: uuid("id").primaryKey(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    sessionId: uuid("session_id").references(() => sessions.id),
    type: text("type").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status", { enum: ["queued", "delivered"] })
      .notNull()
      .default("queued"),
    sequence: integer("sequence").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [unique().on(table.participantId, table.sequence)],
);

export const participantsRelations = relations(participants, ({ one, many }) => ({
  projects: many(projects),
  agentCredential: one(agentCredentials),
  agentConnection: one(agentConnections),
  ticks: many(ticks),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(participants, {
    fields: [projects.ownerParticipantId],
    references: [participants.id],
  }),
  threads: many(threads),
  agreements: many(agreements),
  agentCredentials: many(agentCredentials),
  pullRequests: many(threadPullRequests),
  issueIntakes: many(githubIssueIntakes),
  workClaims: many(workClaims),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  project: one(projects, {
    fields: [threads.projectId],
    references: [projects.id],
  }),
  owner: one(participants, {
    fields: [threads.ownerParticipantId],
    references: [participants.id],
  }),
  proposals: many(proposals),
  posts: many(posts),
  pullRequests: many(threadPullRequests),
  workClaims: many(workClaims),
}));

export const proposalsRelations = relations(proposals, ({ one, many }) => ({
  thread: one(threads, {
    fields: [proposals.threadId],
    references: [threads.id],
  }),
  versions: many(proposalVersions),
}));

export const proposalVersionsRelations = relations(
  proposalVersions,
  ({ one }) => ({
    proposal: one(proposals, {
      fields: [proposalVersions.proposalId],
      references: [proposals.id],
    }),
  }),
);

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  participant: one(participants, {
    fields: [sessions.participantId],
    references: [participants.id],
  }),
  project: one(projects, {
    fields: [sessions.projectId],
    references: [projects.id],
  }),
  goals: many(sessionGoals),
  handovers: many(handovers),
  ticks: many(ticks),
}));

export const sessionGoalsRelations = relations(sessionGoals, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionGoals.sessionId],
    references: [sessions.id],
  }),
}));

export const handoversRelations = relations(handovers, ({ one }) => ({
  session: one(sessions, {
    fields: [handovers.sessionId],
    references: [sessions.id],
  }),
}));

export const agentCredentialsRelations = relations(
  agentCredentials,
  ({ one }) => ({
    participant: one(participants, {
      fields: [agentCredentials.participantId],
      references: [participants.id],
    }),
    project: one(projects, {
      fields: [agentCredentials.projectId],
      references: [projects.id],
    }),
  }),
);

export const agentConnectionsRelations = relations(
  agentConnections,
  ({ one }) => ({
    participant: one(participants, {
      fields: [agentConnections.participantId],
      references: [participants.id],
    }),
  }),
);

export const ticksRelations = relations(ticks, ({ one }) => ({
  participant: one(participants, {
    fields: [ticks.participantId],
    references: [participants.id],
  }),
  session: one(sessions, {
    fields: [ticks.sessionId],
    references: [sessions.id],
  }),
}));

export const schema = {
  participants,
  projects,
  projectMemberships,
  projectInvites,
  roleAssignments,
  threads,
  threadPullRequests,
  workClaims,
  memories,
  personalNotes,
  personalNoteComments,
  githubIssueIntakes,
  githubOauthStates,
  proposals,
  proposalVersions,
  agreements,
  threadConflictCitations,
  posts,
  sessions,
  sessionGoals,
  handovers,
  events,
  agentCredentials,
  agentConnections,
  ticks,
};

export type BoardSchema = typeof schema;
