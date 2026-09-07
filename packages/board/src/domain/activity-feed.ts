import {
  DASHBOARD_ACTIVITY_KINDS,
  DECLARATION_KINDS,
  PARTICIPANT_KINDS,
  POST_TYPES,
  PULL_REQUEST_STATES,
  ROLES,
  THREAD_TYPES,
  formatParticipantLabel,
  type ActivityActor,
  type ActivityItem,
  type ActivitySubject,
  type DashboardActivityKind,
  type ParticipantKind,
} from "@comitia/shared";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  agreements,
  events,
  participants,
  posts,
  projectMemberships,
  projects,
  proposals,
  proposalVersions,
  threadPullRequests,
  threads,
  workClaims,
} from "../db/schema.js";
import type { Db } from "../db/test-setup.js";

const PREVIEW_LENGTH = 120;

type EventRow = typeof events.$inferSelect;

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function enumValue<const T extends readonly string[]>(
  values: T,
  value: unknown,
): T[number] | null {
  return typeof value === "string" && values.includes(value)
    ? (value as T[number])
    : null;
}

function preview(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  const chars = [...normalized];
  return chars.length > PREVIEW_LENGTH
    ? `${chars.slice(0, PREVIEW_LENGTH).join("")}…`
    : normalized;
}

function safeGitHubUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function projectHref(projectId: string, suffix = ""): string {
  const base = `/p/${encodeURIComponent(projectId)}`;
  return suffix ? `${base}/${suffix}` : base;
}

function activityProjectHref(kind: DashboardActivityKind, projectId: string) {
  if (
    kind === "project_membership_added" ||
    kind === "project_membership_removed" ||
    kind === "role_assigned" ||
    kind === "goals_set" ||
    kind === "session_ended" ||
    kind === "session_interrupted"
  ) {
    return projectHref(projectId, "participants");
  }
  if (
    kind === "project_updated" ||
    kind === "project_invite_created" ||
    kind === "github_installation_connected"
  ) {
    return projectHref(projectId, "settings");
  }
  return projectHref(projectId);
}

export async function listRecentActivity(
  db: Db,
  input: { projectId: string; limit: number },
): Promise<ActivityItem[]> {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.projectId, input.projectId),
        inArray(events.kind, [...DASHBOARD_ACTIVITY_KINDS]),
        sql`${events.payload}->>'cause' is null`,
        or(
          ne(events.kind, "work_released"),
          sql`${events.payload}->>'reason' = 'released'`,
        ),
      ),
    )
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(input.limit);

  if (rows.length === 0) return [];

  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  const payloadByEventId = new Map(
    rows.map((row) => [row.id, asRecord(row.payload)]),
  );
  const payloadFor = (row: EventRow) => payloadByEventId.get(row.id) ?? {};

  const threadIds = [
    ...new Set(rows.map((row) => row.threadId).filter((id): id is string => !!id)),
  ];
  const threadRows =
    threadIds.length === 0
      ? []
      : await db
          .select({
            id: threads.id,
            title: threads.title,
            type: threads.type,
            trigger: threads.trigger,
          })
          .from(threads)
          .where(inArray(threads.id, threadIds));
  const threadById = new Map(threadRows.map((row) => [row.id, row]));

  const targetIds = [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.kind === "project_membership_added" ||
            row.kind === "role_assigned",
        )
        .map((row) => stringValue(payloadFor(row).participantId))
        .filter((id): id is string => !!id),
    ),
  ];
  const targetMemberships =
    targetIds.length === 0
      ? []
      : await db
          .select({ participantId: projectMemberships.participantId })
          .from(projectMemberships)
          .where(
            and(
              eq(projectMemberships.projectId, input.projectId),
              inArray(projectMemberships.participantId, targetIds),
            ),
          );
  const allowedTargetIds = new Set(
    targetMemberships.map((row) => row.participantId),
  );

  const actorIds = rows
    .map((row) => row.actorParticipantId)
    .filter((id): id is string => !!id);
  const personIds = [
    ...new Set([...actorIds, ...targetIds.filter((id) => allowedTargetIds.has(id))]),
  ];
  const people =
    personIds.length === 0
      ? []
      : await db
          .select({
            id: participants.id,
            kind: participants.kind,
            displayName: participants.displayName,
            ownerParticipantId: participants.ownerParticipantId,
          })
          .from(participants)
          .where(inArray(participants.id, personIds));
  const ownerIds = [
    ...new Set(
      people
        .map((person) => person.ownerParticipantId)
        .filter((id): id is string => !!id),
    ),
  ];
  const owners =
    ownerIds.length === 0
      ? []
      : await db
          .select({ id: participants.id, displayName: participants.displayName })
          .from(participants)
          .where(inArray(participants.id, ownerIds));
  const ownerNameById = new Map(
    owners.map((owner) => [owner.id, owner.displayName]),
  );
  const personById = new Map(
    people.map((person) => {
      const actor: ActivityActor = {
        id: person.id,
        kind: person.kind,
        displayName: formatParticipantLabel({
          kind: person.kind,
          displayName: person.displayName,
          ownerDisplayName: person.ownerParticipantId
            ? ownerNameById.get(person.ownerParticipantId)
            : undefined,
        }),
      };
      return [person.id, actor];
    }),
  );

  const postIds = [
    ...new Set(
      rows
        .filter(
          (row) => row.kind === "post_added" || row.kind === "objection_resolved",
        )
        .map((row) => stringValue(payloadFor(row).postId))
        .filter((id): id is string => !!id),
    ),
  ];
  const postRows =
    postIds.length === 0
      ? []
      : await db
          .select({ id: posts.id, type: posts.type, body: posts.body })
          .from(posts)
          .where(inArray(posts.id, postIds));
  const postById = new Map(postRows.map((row) => [row.id, row]));

  const versionIds = [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.kind === "proposal_added" ||
            row.kind === "proposal_version_added" ||
            row.kind === "thread_declaration",
        )
        .map((row) => stringValue(payloadFor(row).proposalVersionId))
        .filter((id): id is string => !!id),
    ),
  ];
  const versionRows =
    versionIds.length === 0
      ? []
      : await db
          .select({
            id: proposalVersions.id,
            proposalId: proposalVersions.proposalId,
            versionNumber: proposalVersions.versionNumber,
            content: proposalVersions.content,
            proposalNumber: proposals.number,
          })
          .from(proposalVersions)
          .innerJoin(proposals, eq(proposalVersions.proposalId, proposals.id))
          .where(inArray(proposalVersions.id, versionIds));
  const versionById = new Map(versionRows.map((row) => [row.id, row]));

  const directProposalIds = [
    ...new Set(
      rows
        .filter((row) => row.kind === "proposal_archived")
        .map((row) => stringValue(payloadFor(row).proposalId))
        .filter((id): id is string => !!id),
    ),
  ];
  const directProposalRows =
    directProposalIds.length === 0
      ? []
      : await db
          .select({ id: proposals.id, number: proposals.number })
          .from(proposals)
          .where(inArray(proposals.id, directProposalIds));
  const proposalNumberById = new Map(
    directProposalRows.map((row) => [row.id, row.number]),
  );

  const claimIds = [
    ...new Set(
      rows
        .filter(
          (row) => row.kind === "work_claimed" || row.kind === "work_released",
        )
        .map((row) => stringValue(payloadFor(row).claimId))
        .filter((id): id is string => !!id),
    ),
  ];
  const claimRows =
    claimIds.length === 0
      ? []
      : await db
          .select({ id: workClaims.id, paths: workClaims.paths })
          .from(workClaims)
          .where(inArray(workClaims.id, claimIds));
  const claimPathsById = new Map(
    claimRows.map((row) => [
      row.id,
      Array.isArray(row.paths)
        ? row.paths.filter((path): path is string => typeof path === "string")
        : [],
    ]),
  );

  const prNumbers = [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.kind === "pull_request_linked" ||
            row.kind === "pull_request_synced",
        )
        .map((row) => numberValue(payloadFor(row).number))
        .filter((number): number is number => number !== null),
    ),
  ];
  const prRows =
    prNumbers.length === 0
      ? []
      : await db
          .select({ number: threadPullRequests.number, url: threadPullRequests.url })
          .from(threadPullRequests)
          .where(
            and(
              eq(threadPullRequests.projectId, input.projectId),
              inArray(threadPullRequests.number, prNumbers),
            ),
          );
  const prUrlByNumber = new Map(
    prRows.map((row) => [row.number, safeGitHubUrl(row.url)]),
  );

  const replacementAgreementIds = [
    ...new Set(
      rows
        .filter((row) => row.kind === "agreement_superseded")
        .map((row) => stringValue(payloadFor(row).byAgreementId))
        .filter((id): id is string => !!id),
    ),
  ];
  const replacementAgreements =
    replacementAgreementIds.length === 0
      ? []
      : await db
          .select({ id: agreements.id, summary: agreements.summary })
          .from(agreements)
          .where(inArray(agreements.id, replacementAgreementIds));
  const agreementSummaryById = new Map(
    replacementAgreements.map((row) => [row.id, row.summary]),
  );

  const subjectFor = (
    row: EventRow,
    kind: DashboardActivityKind,
  ): ActivitySubject => {
    if (row.threadId) {
      const thread = threadById.get(row.threadId);
      if (thread) {
        return {
          type: "thread",
          id: thread.id,
          title: thread.title,
          href:
            kind === "thread_archived"
              ? projectHref(input.projectId, "threads")
              : projectHref(input.projectId, `threads/${thread.id}`),
        };
      }
      return {
        type: "unavailable",
        label: "対象を確認できません",
        href: null,
      };
    }
    if (!project) {
      return {
        type: "unavailable",
        label: "対象を確認できません",
        href: null,
      };
    }
    return {
      type: "project",
      id: project.id,
      name: project.name,
      href: activityProjectHref(kind, project.id),
    };
  };

  return rows.map((row) => {
    const kind = row.kind as DashboardActivityKind;
    const payload = payloadFor(row);
    const interrupted = kind === "session_interrupted";
    const actor = interrupted
      ? null
      : row.actorParticipantId
        ? personById.get(row.actorParticipantId) ?? null
        : null;
    const base = {
      id: row.id,
      actor,
      subject: subjectFor(row, kind),
      createdAt: row.createdAt.toISOString(),
    };

    switch (kind) {
      case "thread_created": {
        const thread = row.threadId ? threadById.get(row.threadId) : undefined;
        return {
          ...base,
          kind,
          detail: {
            type: "thread",
            threadType: enumValue(THREAD_TYPES, thread?.type ?? payload.type),
            preview: preview(thread?.trigger),
          },
        };
      }
      case "post_added": {
        const postId = stringValue(payload.postId);
        const post = postId ? postById.get(postId) : undefined;
        return {
          ...base,
          kind,
          detail: {
            type: "post",
            postId,
            postType: enumValue(POST_TYPES, post?.type ?? payload.type),
            preview: preview(post?.body),
          },
        };
      }
      case "proposal_added":
      case "proposal_version_added": {
        const versionId = stringValue(payload.proposalVersionId);
        const version = versionId ? versionById.get(versionId) : undefined;
        return {
          ...base,
          kind,
          detail: {
            type: "proposal",
            proposalId: version?.proposalId ?? stringValue(payload.proposalId),
            number: version?.proposalNumber ?? numberValue(payload.number),
            versionNumber:
              version?.versionNumber ?? numberValue(payload.versionNumber),
            preview: preview(version?.content),
          },
        };
      }
      case "objection_resolved": {
        const postId = stringValue(payload.postId);
        return {
          ...base,
          kind,
          detail: {
            type: "objection",
            postId,
            preview: preview(postId ? postById.get(postId)?.body : null),
          },
        };
      }
      case "thread_declaration": {
        const versionId = stringValue(payload.proposalVersionId);
        const version = versionId ? versionById.get(versionId) : undefined;
        return {
          ...base,
          kind,
          detail: {
            type: "declaration",
            declarationKind: enumValue(
              DECLARATION_KINDS,
              payload.declarationKind,
            ),
            proposalId: version?.proposalId ?? null,
            proposalNumber: version?.proposalNumber ?? null,
            versionNumber: version?.versionNumber ?? null,
            summary: preview(stringValue(payload.summary)),
            reason: preview(stringValue(payload.reason)),
            hours: numberValue(payload.hours),
          },
        };
      }
      case "work_claimed":
      case "work_released": {
        const claimId = stringValue(payload.claimId);
        const payloadPaths = Array.isArray(payload.paths)
          ? payload.paths.filter((path): path is string => typeof path === "string")
          : null;
        const paths =
          payloadPaths ?? (claimId ? claimPathsById.get(claimId) ?? [] : []);
        return {
          ...base,
          kind,
          detail: {
            type: "work",
            paths: paths.slice(0, 3),
            pathCount: paths.length,
          },
        };
      }
      case "pull_request_linked":
      case "pull_request_synced": {
        const number = numberValue(payload.number);
        return {
          ...base,
          kind,
          detail: {
            type: "pullRequest",
            number,
            title: stringValue(payload.title),
            state: enumValue(
              PULL_REQUEST_STATES,
              payload.toState ?? payload.state,
            ),
            fromState: enumValue(PULL_REQUEST_STATES, payload.fromState),
            externalUrl:
              number === null ? null : (prUrlByNumber.get(number) ?? null),
          },
        };
      }
      case "agreement_superseded": {
        const replacementId = stringValue(payload.byAgreementId);
        return {
          ...base,
          kind,
          detail: {
            type: "agreement",
            summary:
              preview(
                replacementId
                  ? agreementSummaryById.get(replacementId)
                  : null,
              ) ?? null,
          },
        };
      }
      case "proposal_archived": {
        const proposalId = stringValue(payload.proposalId);
        return {
          ...base,
          kind,
          detail: {
            type: "proposal",
            proposalId,
            number: proposalId
              ? (proposalNumberById.get(proposalId) ?? null)
              : null,
            versionNumber: null,
            preview: null,
          },
        };
      }
      case "thread_archived":
        return {
          ...base,
          kind,
          detail: { type: "thread", threadType: null, preview: null },
        };
      case "project_created":
      case "project_updated":
        return {
          ...base,
          kind,
          detail: {
            type: "project",
            name: stringValue(payload.name) ?? project?.name ?? null,
            repoUrl: stringValue(payload.repoUrl),
          },
        };
      case "project_membership_added": {
        const participantId = stringValue(payload.participantId);
        const target =
          participantId && allowedTargetIds.has(participantId)
            ? personById.get(participantId)
            : undefined;
        return {
          ...base,
          kind,
          detail: {
            type: "membership",
            participantId,
            displayName: target?.displayName ?? null,
            participantKind: target?.kind ?? null,
          },
        };
      }
      case "project_membership_removed":
        return {
          ...base,
          kind,
          detail: {
            type: "membership",
            participantId: stringValue(payload.participantId),
            displayName: stringValue(payload.displayName),
            participantKind: enumValue(
              PARTICIPANT_KINDS,
              payload.participantKind,
            ) as ParticipantKind | null,
          },
        };
      case "project_invite_created":
        return { ...base, kind, detail: { type: "invite" } };
      case "role_assigned": {
        const participantId = stringValue(payload.participantId);
        const target =
          participantId && allowedTargetIds.has(participantId)
            ? personById.get(participantId)
            : undefined;
        return {
          ...base,
          kind,
          detail: {
            type: "role",
            participantId,
            displayName: target?.displayName ?? null,
            role: enumValue(ROLES, payload.role),
          },
        };
      }
      case "github_installation_connected": {
        const owner = stringValue(payload.owner);
        const repo = stringValue(payload.repo);
        return {
          ...base,
          kind,
          detail: {
            type: "repository",
            owner,
            repo,
            externalUrl:
              owner && repo
                ? safeGitHubUrl(
                    `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
                  )
                : null,
          },
        };
      }
      case "github_issue_redirected":
        return {
          ...base,
          kind,
          detail: {
            type: "issue",
            number: numberValue(payload.issueNumber),
            externalUrl: safeGitHubUrl(payload.htmlUrl),
          },
        };
      case "goals_set":
        return {
          ...base,
          kind,
          detail: {
            type: "goals",
            goalCount: numberValue(payload.goalCount),
          },
        };
      case "session_ended":
      case "session_interrupted": {
        const participant = row.actorParticipantId
          ? personById.get(row.actorParticipantId)
          : undefined;
        return {
          ...base,
          kind,
          detail: {
            type: "session",
            sessionId: stringValue(payload.sessionId),
            participantId:
              kind === "session_interrupted"
                ? (row.actorParticipantId ?? null)
                : null,
            displayName:
              kind === "session_interrupted"
                ? (participant?.displayName ?? null)
                : null,
          },
        };
      }
    }
  });
}
