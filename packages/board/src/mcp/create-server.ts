import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CONSENSUS_TYPES,
  POST_TYPES,
  PROPOSAL_TARGETS,
  SHARED_ARTIFACT_KINDS,
  THREAD_STATES,
  THREAD_TYPES,
  declarationKindSchema,
} from "@comitia/shared";
import { z, ZodError } from "zod";
import type { Db, DbClient } from "../db/test-setup.js";
import { spend } from "../domain/activity.js";
import { searchAgreements } from "../domain/agreements.js";
import { getBriefing } from "../domain/briefing.js";
import { declare } from "../domain/declare.js";
import {
  DomainError,
  GateViolation,
  NotFoundError,
  PermissionDenied,
} from "../domain/errors.js";
import { getThreadRow } from "../domain/helpers.js";
import { listActiveMemory, writeMemory } from "../domain/memory.js";
import { commentNote, readNote, searchNotes, writeNote } from "../domain/notes.js";
import { addPost } from "../domain/posts.js";
import { addProposal } from "../domain/proposals.js";
import { readThread } from "../domain/read-thread.js";
import {
  completeGoal,
  endSession,
  openOrGetSession,
  setGoals,
} from "../domain/sessions.js";
import { createThread, searchThreads } from "../domain/threads.js";
import { linkPullRequest } from "../domain/pull-requests.js";
import {
  claimWork,
  listActiveProjectClaims,
  releaseWork,
} from "../domain/work-claims.js";
import type { GitHubClient } from "../github/types.js";

export type ToolCallResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolCallResult>;

function toolError(message: string): ToolCallResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function jsonResult(data: Record<string, unknown>): ToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function mapDomainError(error: unknown): ToolCallResult | null {
  if (error instanceof ZodError) {
    return toolError(error.issues.map((issue) => issue.message).join("; "));
  }
  if (
    error instanceof GateViolation ||
    error instanceof NotFoundError ||
    error instanceof PermissionDenied ||
    error instanceof DomainError
  ) {
    return toolError(error.message);
  }
  return null;
}

export function createBoardToolRuntime(input: {
  db: Db;
  participantId: string;
  projectId: string;
  github?: GitHubClient;
}) {
  const { db, participantId, projectId, github } = input;
  let sessionId: string | null = null;

  async function ensureSessionId(): Promise<string> {
    if (sessionId) {
      return sessionId;
    }
    const session = await openOrGetSession(db, { participantId, projectId });
    sessionId = session.id;
    return session.id;
  }

  async function runTool(
    toolName: string,
    handler: () => Promise<Record<string, unknown>>,
    options?: { threadId?: string },
  ): Promise<ToolCallResult> {
    try {
      const sid = await ensureSessionId();
      const remaining = await spend(db, sid, toolName, options?.threadId);
      const data = await handler();
      return jsonResult({ ...data, remaining_budget: remaining });
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) {
        return mapped;
      }
      throw error;
    }
  }

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  /** Resolves args.thread_id to a real thread id for budget-event tagging, or undefined if malformed/unknown. */
  async function resolveThreadId(raw: unknown): Promise<string | undefined> {
    if (typeof raw !== "string" || !UUID_RE.test(raw)) {
      return undefined;
    }
    try {
      await getThreadRow(db, raw);
      return raw;
    } catch {
      return undefined;
    }
  }

  const handlers: Record<string, ToolHandler> = {
    get_briefing: async () => {
      try {
        const briefing = await getBriefing(db, { participantId, projectId });
        sessionId = briefing.sessionId;
        const remaining = await spend(db, briefing.sessionId, "get_briefing");
        const { sessionId: _sid, remaining_budget: _rb, ...pack } = briefing;
        return jsonResult({ ...pack, remaining_budget: remaining });
      } catch (error) {
        const mapped = mapDomainError(error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },

    set_goals: async (args) =>
      runTool("set_goals", async () => {
        const sid = await ensureSessionId();
        const parsed = z.object({ goals: z.array(z.string()).min(1) }).parse(args);
        const goals = await setGoals(db, { sessionId: sid, texts: parsed.goals });
        return {
          ok: true,
          goals: goals.map((g) => ({ id: g.id, text: g.text, status: g.status })),
        };
      }),

    complete_goal: async (args) =>
      runTool("complete_goal", async () => {
        const sid = await ensureSessionId();
        const parsed = z.object({ goal_id: z.string().uuid() }).parse(args);
        const goal = await completeGoal(db, {
          sessionId: sid,
          goalId: parsed.goal_id,
        });
        return { ok: true, goal_id: goal.id, status: goal.status };
      }),

    search_threads: async (args) =>
      runTool("search_threads", async () => {
        const parsed = z
          .object({
            textQuery: z.string().optional(),
            state: z.enum(THREAD_STATES).optional(),
          })
          .parse(args);
        const rows = await searchThreads(db, {
          projectId,
          textQuery: parsed.textQuery,
          state: parsed.state,
        });
        return {
          threads: rows.map((t) => ({
            id: t.id,
            title: t.title,
            type: t.type,
            state: t.state,
          })),
        };
      }),

    search_decisions: async (args) =>
      runTool("search_decisions", async () => {
        const parsed = z
          .object({ onlyActiveBinding: z.boolean().optional() })
          .parse(args);
        const rows = await searchAgreements(db, {
          projectId,
          onlyActiveBinding: parsed.onlyActiveBinding,
        });
        return { agreements: rows };
      }),

    read_thread: async (args) => {
      const threadId = await resolveThreadId(args.thread_id);
      return runTool(
        "read_thread",
        async () => {
          const parsed = z.object({ thread_id: z.string().uuid() }).parse(args);
          return (await readThread(db, parsed.thread_id)) as unknown as Record<
            string,
            unknown
          >;
        },
        { threadId },
      );
    },

    create_thread: async (args) =>
      runTool("create_thread", async () => {
        const parsed = z
          .object({
            type: z.enum(THREAD_TYPES),
            title: z.string().min(1),
            trigger: z.string().min(1),
            duplicateSearchQuery: z.string().min(1),
            consensusType: z.enum(CONSENSUS_TYPES).optional(),
            humanRequired: z.boolean().optional(),
            target: z.enum(PROPOSAL_TARGETS).optional(),
            sharedArtifactKind: z.enum(SHARED_ARTIFACT_KINDS).optional(),
            conflictCitationsChecked: z.boolean().optional(),
            parentThreadId: z.string().uuid().optional(),
          })
          .parse(args);
        const thread = await createThread(db, {
          projectId,
          ownerId: participantId,
          type: parsed.type,
          title: parsed.title,
          trigger: parsed.trigger,
          duplicateSearchQuery: parsed.duplicateSearchQuery,
          consensusType: parsed.consensusType,
          humanRequired: parsed.humanRequired,
          target: parsed.target,
          sharedArtifactKind: parsed.sharedArtifactKind,
          conflictCitationsChecked: parsed.conflictCitationsChecked,
          parentThreadId: parsed.parentThreadId,
        });
        return { thread_id: thread.id, state: thread.state };
      }),

    add_proposal: async (args) => {
      const threadId = await resolveThreadId(args.thread_id);
      return runTool(
        "add_proposal",
        async () => {
          const parsed = z
            .object({
              thread_id: z.string().uuid(),
              content: z.string().min(1),
            })
            .parse(args);
          const { proposal, version } = await addProposal(db, {
            threadId: parsed.thread_id,
            authorId: participantId,
            content: parsed.content,
          });
          return {
            proposal_id: proposal.id,
            proposal_version_id: version.id,
            number: proposal.number,
          };
        },
        { threadId },
      );
    },

    post: async (args) => {
      const threadId = await resolveThreadId(args.thread_id);
      return runTool(
        "post",
        async () => {
          const parsed = z
            .object({
              thread_id: z.string().uuid(),
              type: z.enum(POST_TYPES),
              body: z.string().min(1),
              rationale: z.string().optional(),
              blocking: z.boolean().optional(),
              proposal_version_id: z.string().uuid().optional(),
            })
            .parse(args);
          const post = await addPost(db, {
            threadId: parsed.thread_id,
            authorId: participantId,
            type: parsed.type,
            body: parsed.body,
            rationale: parsed.rationale,
            blocking: parsed.blocking,
            proposalVersionId: parsed.proposal_version_id,
          });
          return { post_id: post.id, type: post.type };
        },
        { threadId },
      );
    },

    declare: async (args) => {
      const threadId = await resolveThreadId(args.thread_id);
      return runTool(
        "declare",
        async () => {
          const parsed = z
            .object({
              thread_id: z.string().uuid(),
              kind: declarationKindSchema,
              payload: z.record(z.string(), z.unknown()).default({}),
            })
            .parse(args);
          const result = await declare(db as DbClient, {
            threadId: parsed.thread_id,
            actorId: participantId,
            kind: parsed.kind,
            payload: parsed.payload,
          });
          return {
            thread_id: parsed.thread_id,
            state: result.thread.state,
            kind: parsed.kind,
          };
        },
        { threadId },
      );
    },

    link_pull_request: async (args) => {
      const threadId = await resolveThreadId(args.thread_id);
      return runTool(
        "link_pull_request",
        async () => {
          if (!github) {
            throw new GateViolation("GitHub App が接続されていません");
          }
          const parsed = z
            .object({
              thread_id: z.string().uuid(),
              url: z.string().url(),
            })
            .parse(args);
          const row = await linkPullRequest(db, github, {
            threadId: parsed.thread_id,
            actorId: participantId,
            url: parsed.url,
          });
          return {
            thread_id: parsed.thread_id,
            number: row.number,
            url: row.url,
            title: row.title,
            state: row.state,
          };
        },
        { threadId },
      );
    },

    claim_work: async (args) => {
      const threadId = await resolveThreadId(args.thread_id);
      return runTool(
        "claim_work",
        async () => {
          const parsed = z
            .object({
              thread_id: z.string().uuid(),
              paths: z.array(z.string().min(1)).min(1),
            })
            .parse(args);
          const result = await claimWork(db, {
            threadId: parsed.thread_id,
            participantId,
            paths: parsed.paths,
          });
          return {
            claim_id: result.claim.id,
            thread_id: result.claim.threadId,
            paths: result.claim.paths,
            post_id: result.post.id,
            overlaps: result.overlaps,
          };
        },
        { threadId },
      );
    },

    release_work: async (args) =>
      runTool("release_work", async () => {
        const parsed = z.object({ claim_id: z.string().uuid() }).parse(args);
        const claim = await releaseWork(db, {
          claimId: parsed.claim_id,
          actorId: participantId,
        });
        return { claim_id: claim.id, active: claim.active };
      }),

    list_work_claims: async () =>
      runTool("list_work_claims", async () => ({
        claims: await listActiveProjectClaims(db, projectId),
      })),

    write_memory: async (args) =>
      runTool("write_memory", async () => {
        const parsed = z
          .object({ body: z.string().min(1), supersede_id: z.string().uuid().optional() })
          .parse(args);
        const memory = await writeMemory(db, {
          participantId,
          body: parsed.body,
          supersedeId: parsed.supersede_id,
        });
        return { memory_id: memory.id };
      }),

    write_note: async (args) =>
      runTool("write_note", async () => {
        const parsed = z
          .object({
            note_id: z.string().uuid().optional(),
            title: z.string().min(1),
            body: z.string().min(1),
            format: z.enum(["file", "journal"]),
            visibility: z.enum(["public", "private"]).optional(),
          })
          .parse(args);
        const note = await writeNote(db, {
          authorParticipantId: participantId,
          projectId,
          noteId: parsed.note_id,
          title: parsed.title,
          body: parsed.body,
          format: parsed.format,
          visibility: parsed.visibility,
        });
        return {
          note_id: note.id,
          title: note.title,
          visibility: note.visibility,
        };
      }),

    search_notes: async (args) =>
      runTool("search_notes", async () => {
        const parsed = z.object({ textQuery: z.string().optional() }).parse(args);
        const notes = await searchNotes(db, {
          callerId: participantId,
          projectId,
          textQuery: parsed.textQuery,
        });
        return {
          notes: notes.map((n) => ({
            id: n.id,
            title: n.title,
            visibility: n.visibility,
            authorParticipantId: n.authorParticipantId,
          })),
        };
      }),

    read_note: async (args) =>
      runTool("read_note", async () => {
        const parsed = z.object({ note_id: z.string().uuid() }).parse(args);
        const note = await readNote(db, { noteId: parsed.note_id, callerId: participantId });
        return {
          note_id: note.id,
          title: note.title,
          body: note.body,
          format: note.format,
          visibility: note.visibility,
        };
      }),

    comment_note: async (args) =>
      runTool("comment_note", async () => {
        const parsed = z
          .object({ note_id: z.string().uuid(), body: z.string().min(1) })
          .parse(args);
        const comment = await commentNote(db, {
          noteId: parsed.note_id,
          authorParticipantId: participantId,
          body: parsed.body,
        });
        return { comment_id: comment.id };
      }),

    end_session: async (args) => {
      try {
        const sid = await ensureSessionId();
        const parsed = z.object({ handover: z.string() }).parse(args);
        if (!parsed.handover.trim()) {
          return toolError("申し送り（handover）は必須です");
        }
        const remaining = await spend(db, sid, "end_session");
        await endSession(db, { sessionId: sid, handover: parsed.handover });
        sessionId = null;
        return jsonResult({ ok: true, remaining_budget: remaining });
      } catch (error) {
        const mapped = mapDomainError(error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  };

  async function callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolCallResult> {
    const handler = handlers[name];
    if (!handler) {
      return toolError(`未知のツール: ${name}`);
    }
    return handler(args);
  }

  function parseJsonContent(result: ToolCallResult): Record<string, unknown> {
    const text = result.content[0]?.text ?? "{}";
    return JSON.parse(text) as Record<string, unknown>;
  }

  return { callTool, parseJsonContent };
}

export type BoardToolRuntime = ReturnType<typeof createBoardToolRuntime>;

export function createBoardMcpServer(input: {
  db: Db;
  participantId: string;
  projectId: string;
  github?: GitHubClient;
}) {
  const runtime = createBoardToolRuntime(input);

  const server = new McpServer({
    name: "comitia-board",
    version: "0.0.1",
  });

  server.registerTool(
    "get_briefing",
    {
      description: "コンテキストパック（申し送り・ルール・状況）を取得する",
      inputSchema: {},
    },
    async () => runtime.callTool("get_briefing"),
  );

  server.registerTool(
    "set_goals",
    {
      description: "その日の目標を宣言する",
      inputSchema: {
        goals: z.array(z.string()).min(1),
      },
    },
    async (args) => runtime.callTool("set_goals", args as Record<string, unknown>),
  );

  server.registerTool(
    "complete_goal",
    {
      description: "宣言済み目標を完了にする",
      inputSchema: {
        goal_id: z.string().uuid(),
      },
    },
    async (args) =>
      runtime.callTool("complete_goal", args as Record<string, unknown>),
  );

  server.registerTool(
    "search_threads",
    {
      description: "プロジェクト内のスレッドを検索する",
      inputSchema: {
        textQuery: z.string().optional(),
        state: z.enum(THREAD_STATES).optional(),
      },
    },
    async (args) =>
      runtime.callTool("search_threads", args as Record<string, unknown>),
  );

  server.registerTool(
    "search_decisions",
    {
      description: "合意物（決定）を検索する",
      inputSchema: {
        onlyActiveBinding: z.boolean().optional(),
      },
    },
    async (args) =>
      runtime.callTool("search_decisions", args as Record<string, unknown>),
  );

  server.registerTool(
    "read_thread",
    {
      description: "スレッド内容を読む",
      inputSchema: {
        thread_id: z.string().uuid(),
      },
    },
    async (args) =>
      runtime.callTool("read_thread", args as Record<string, unknown>),
  );

  server.registerTool(
    "create_thread",
    {
      description: "新しいスレッドを作成する",
      inputSchema: {
        type: z.enum(THREAD_TYPES),
        title: z.string().min(1),
        trigger: z.string().min(1),
        duplicateSearchQuery: z.string().min(1),
        consensusType: z.enum(CONSENSUS_TYPES).optional(),
        humanRequired: z.boolean().optional(),
        target: z.enum(PROPOSAL_TARGETS).optional(),
        sharedArtifactKind: z.enum(SHARED_ARTIFACT_KINDS).optional(),
        conflictCitationsChecked: z.boolean().optional(),
        parentThreadId: z.string().uuid().optional(),
      },
    },
    async (args) =>
      runtime.callTool("create_thread", args as Record<string, unknown>),
  );

  server.registerTool(
    "add_proposal",
    {
      description: "スレッドに提案を追加する",
      inputSchema: {
        thread_id: z.string().uuid(),
        content: z.string().min(1),
      },
    },
    async (args) =>
      runtime.callTool("add_proposal", args as Record<string, unknown>),
  );

  server.registerTool(
    "post",
    {
      description: "スレッドに投稿する",
      inputSchema: {
        thread_id: z.string().uuid(),
        type: z.enum(POST_TYPES),
        body: z.string().min(1),
        rationale: z.string().optional(),
        blocking: z.boolean().optional(),
        proposal_version_id: z.string().uuid().optional(),
      },
    },
    async (args) => runtime.callTool("post", args as Record<string, unknown>),
  );

  server.registerTool(
    "declare",
    {
      description: "宣言による状態遷移を行う",
      inputSchema: {
        thread_id: z.string().uuid(),
        kind: declarationKindSchema,
        payload: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => runtime.callTool("declare", args as Record<string, unknown>),
  );

  server.registerTool(
    "link_pull_request",
    {
      description: "スレッドに GitHub PR をリンクする",
      inputSchema: {
        thread_id: z.string().uuid(),
        url: z.string().url(),
      },
    },
    async (args) =>
      runtime.callTool("link_pull_request", args as Record<string, unknown>),
  );

  server.registerTool(
    "claim_work",
    {
      description: "作業範囲を着手表明する。重なる他者の着手は結果に出るが止まらない",
      inputSchema: {
        thread_id: z.string().uuid(),
        paths: z.array(z.string().min(1)).min(1),
      },
    },
    async (args) => runtime.callTool("claim_work", args as Record<string, unknown>),
  );

  server.registerTool(
    "release_work",
    {
      description: "自分の着手表明を解除する",
      inputSchema: {
        claim_id: z.string().uuid(),
      },
    },
    async (args) =>
      runtime.callTool("release_work", args as Record<string, unknown>),
  );

  server.registerTool(
    "list_work_claims",
    {
      description: "プロジェクトの active な着手を見る",
      inputSchema: {},
    },
    async (args) =>
      runtime.callTool("list_work_claims", args as Record<string, unknown>),
  );

  server.registerTool(
    "write_memory",
    {
      description: "個別記憶を書く（追記、または supersede_id で自分の記憶を置き換え）",
      inputSchema: {
        body: z.string().min(1),
        supersede_id: z.string().uuid().optional(),
      },
    },
    async (args) => runtime.callTool("write_memory", args as Record<string, unknown>),
  );

  server.registerTool(
    "write_note",
    {
      description: "公開メモ（または非公開メモ）を作成・更新する",
      inputSchema: {
        note_id: z.string().uuid().optional(),
        title: z.string().min(1),
        body: z.string().min(1),
        format: z.enum(["file", "journal"]),
        visibility: z.enum(["public", "private"]).optional(),
      },
    },
    async (args) => runtime.callTool("write_note", args as Record<string, unknown>),
  );

  server.registerTool(
    "search_notes",
    {
      description: "公開メモと自分の非公開メモを検索する",
      inputSchema: {
        textQuery: z.string().optional(),
      },
    },
    async (args) => runtime.callTool("search_notes", args as Record<string, unknown>),
  );

  server.registerTool(
    "read_note",
    {
      description: "メモを読む（非公開は本人のみ）",
      inputSchema: {
        note_id: z.string().uuid(),
      },
    },
    async (args) => runtime.callTool("read_note", args as Record<string, unknown>),
  );

  server.registerTool(
    "comment_note",
    {
      description: "公開メモにコメントする",
      inputSchema: {
        note_id: z.string().uuid(),
        body: z.string().min(1),
      },
    },
    async (args) => runtime.callTool("comment_note", args as Record<string, unknown>),
  );

  server.registerTool(
    "end_session",
    {
      description: "セッションを終了する（申し送り必須）",
      inputSchema: {
        handover: z.string(),
      },
    },
    async (args) =>
      runtime.callTool("end_session", args as Record<string, unknown>),
  );

  return {
    server,
    callTool: runtime.callTool,
    parseJsonContent: runtime.parseJsonContent,
  };
}

export type BoardMcpServer = ReturnType<typeof createBoardMcpServer>;
