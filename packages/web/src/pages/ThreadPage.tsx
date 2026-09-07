import { canCompleteThread } from "@comitia/shared";
import { type FormEvent, useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  boardClient,
  type HumanThreadView,
  type MeResponse,
} from "../api.js";
import { PostTypeBadge, ThreadBadges } from "../components/Badges.js";
import { FieldCaption } from "../components/FieldCaption.js";
import { MarkdownBody } from "../components/MarkdownBody.js";
import { SynthesisCard } from "../components/SynthesisCard.js";
import {
  TemplatePicker,
  type SystemTemplateItem,
} from "../components/TemplatePicker.js";
import { pullRequestStateLabel } from "../labels.js";
import { projectPath } from "../projectContext.js";
import { formatRelativeTimeJa } from "../relativeTime.js";
import { sortThreadPostsByCreatedAtDesc } from "../threadPostView.js";
import { useRouteLoad } from "../useRouteLoad.js";
import { activeWorkClaimantNames } from "../workClaimLabels.js";

const COMPOSER_POST_TYPES = [
  ["comment", "コメント"],
  ["question", "質問"],
  ["position", "意見"],
  ["objection", "異議"],
  ["approval", "承認"],
  ["synthesis", "統合"],
  ["report", "報告"],
] as const;

type ComposerPostType = (typeof COMPOSER_POST_TYPES)[number][0];
type ComposerKind = ComposerPostType | "proposal" | "work_claim" | "reject";

export function ThreadPage() {
  const { projectId, id } = useParams<{ projectId: string; id: string }>();
  const [view, setView] = useState<HumanThreadView | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null);
  const [hasBindingAgreement, setHasBindingAgreement] = useState(false);
  const [threadDeleted, setThreadDeleted] = useState(false);
  const [threadDeleteConfirm, setThreadDeleteConfirm] = useState(false);
  const [proposalDeleteId, setProposalDeleteId] = useState<string | null>(null);
  const [proposalDeleteConfirm, setProposalDeleteConfirm] = useState(false);
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeclaring, setIsDeclaring] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const [composerKind, setComposerKind] = useState<ComposerKind>("comment");
  const [postBody, setPostBody] = useState("");
  const [rationale, setRationale] = useState("");
  const [proposalContent, setProposalContent] = useState("");
  const [proposalTemplateId, setProposalTemplateId] = useState("");
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplateItem[]>(
    [],
  );
  const [targetVersionId, setTargetVersionId] = useState("");
  const [ownerSummary, setOwnerSummary] = useState("");
  const [claimPathsText, setClaimPathsText] = useState("");

  const reset = useCallback(() => {
    setView(null);
    setMe(null);
    setProjectOwnerId(null);
    setHasBindingAgreement(false);
    setThreadDeleted(false);
    setThreadDeleteConfirm(false);
    setProposalDeleteId(null);
    setProposalDeleteConfirm(false);
    setSummary("");
    setReason("");
    setError(null);
    setRejectConfirmOpen(false);
    setComposerKind("comment");
    setPostBody("");
    setRationale("");
    setProposalContent("");
    setProposalTemplateId("");
    setSystemTemplates([]);
    setTargetVersionId("");
    setOwnerSummary("");
    setClaimPathsText("");
  }, []);

  const load = useCallback(() => {
    if (!id || !projectId) {
      return;
    }
    Promise.all([
      boardClient.thread(id),
      boardClient.me(),
      boardClient.getProject(projectId),
      boardClient.agreements(),
    ])
      .then(([thread, identity, project, agreementRes]) => {
        setView(thread);
        setMe(identity);
        setProjectOwnerId(project.ownerParticipantId);
        setHasBindingAgreement(
          agreementRes.items.some(
            (item) => item.threadId === id && item.binding,
          ),
        );
        const kind = thread.thread.sharedArtifactKind;
        if (kind === "project_rule" || kind === "thread_template") {
          return boardClient.listSystemTemplates(kind).then((res) => {
            setSystemTemplates(res.items);
          });
        }
        setSystemTemplates([]);
        return undefined;
      })
      .catch((err: Error) => setError(err.message));
  }, [id, projectId]);

  useRouteLoad(load, [id, projectId], reset);

  async function reloadThread() {
    if (!id) {
      return;
    }
    const next = await boardClient.thread(id);
    setView(next);
  }

  async function runDeclare(payload: Record<string, unknown>) {
    if (!id) {
      return;
    }
    setError(null);
    setIsDeclaring(true);
    try {
      await boardClient.declare(id, payload);
      setRejectConfirmOpen(false);
      await reloadThread();
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setIsDeclaring(false);
    }
  }

  function onRatify(event: FormEvent) {
    event.preventDefault();
    if (!summary.trim()) {
      return;
    }
    void runDeclare({ kind: "ratify", binding: true, summary });
  }

  function onSendBack() {
    if (!reason.trim()) {
      return;
    }
    void runDeclare({ kind: "send_back", reason });
  }

  function onRejectClick() {
    if (!summary.trim()) {
      return;
    }
    if (!rejectConfirmOpen) {
      setRejectConfirmOpen(true);
      return;
    }
    void runDeclare({ kind: "reject_thread", summary });
  }

  async function onPost(event: FormEvent, postType: ComposerPostType) {
    event.preventDefault();
    if (!id || !postBody.trim()) {
      return;
    }
    const needsRationale =
      postType === "objection" || postType === "approval";
    if (needsRationale && (!rationale.trim() || !targetVersionId)) {
      setError("根拠と対象の提案が必要です");
      return;
    }
    setError(null);
    setIsDeclaring(true);
    try {
      await boardClient.addPost(id, {
        type: postType,
        body: postBody,
        rationale: needsRationale ? rationale : undefined,
        blocking: postType === "objection" ? true : undefined,
        proposalVersionId: needsRationale ? targetVersionId : undefined,
      });
      setPostBody("");
      setRationale("");
      await reloadThread();
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setIsDeclaring(false);
    }
  }

  async function onAddProposal(event: FormEvent) {
    event.preventDefault();
    if (!id || !proposalContent.trim()) {
      return;
    }
    setError(null);
    setIsDeclaring(true);
    try {
      await boardClient.addProposal(id, proposalContent);
      setProposalContent("");
      await reloadThread();
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setIsDeclaring(false);
    }
  }

  async function onClaimWork(event: FormEvent) {
    event.preventDefault();
    if (!id) {
      return;
    }
    const paths = claimPathsText
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    if (paths.length === 0) {
      return;
    }
    setError(null);
    setIsDeclaring(true);
    try {
      await boardClient.claimWork(id, paths);
      setClaimPathsText("");
      await reloadThread();
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setIsDeclaring(false);
    }
  }

  async function onReleaseWork(claimId: string) {
    if (!id) {
      return;
    }
    setError(null);
    setIsDeclaring(true);
    try {
      await boardClient.releaseWork(id, claimId);
      await reloadThread();
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setIsDeclaring(false);
    }
  }

  function requestDeleteThread() {
    setThreadDeleteConfirm(true);
  }

  async function confirmDeleteThread() {
    if (!id) {
      return;
    }
    setError(null);
    setIsDeclaring(true);
    try {
      await boardClient.archiveThread(id);
      setThreadDeleted(true);
      setThreadDeleteConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setIsDeclaring(false);
    }
  }

  function requestDeleteProposal(proposalId: string) {
    setProposalDeleteId(proposalId);
    setProposalDeleteConfirm(true);
  }

  async function confirmDeleteProposal(proposalId: string) {
    if (!id) {
      return;
    }
    setError(null);
    setIsDeclaring(true);
    try {
      await boardClient.archiveProposal(id, proposalId);
      setProposalDeleteId(null);
      setProposalDeleteConfirm(false);
      await reloadThread();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setIsDeclaring(false);
    }
  }

  if (!projectId) {
    return null;
  }
  if (threadDeleted) {
    return (
      <article>
        <p className="status status-empty">このスレッドは削除されました</p>
        <Link to={projectPath(projectId, "threads")} className="back-link">
          スレッド一覧へ
        </Link>
      </article>
    );
  }
  if (error && !view) {
    return <p className="status status-error">{error}</p>;
  }
  if (!view) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  const awaiting = view.thread.state === "awaiting_decision";
  const discussing = view.thread.state === "discussing";
  const isBrainstorm = view.thread.type === "brainstorm";
  const canCompose = discussing || awaiting;
  const canPropose = discussing && !isBrainstorm;
  const isThreadOwner = me?.participant.id === view.thread.ownerParticipantId;
  const isProjectOwner = me?.participant.id === projectOwnerId;
  // declare 側の門に合わせる。select_candidate と reject_thread は
  // assertThreadOwnerOrProjectOwner なので、プロジェクトオーナーも打てる。
  const canSelectCandidate = isThreadOwner || isProjectOwner;
  const canRejectThread = isThreadOwner || isProjectOwner;
  const canClaimWork =
    view.thread.state !== "completed" && view.thread.state !== "rejected";
  const showRejectWhileDiscussing = discussing && canRejectThread;

  const rejectConfirm = rejectConfirmOpen ? (
    <div className="decision-confirm" role="group" aria-label="不採用の確認">
      <p>不採用にする。このスレッドは閉じる</p>
      <div className="actions">
        <button
          type="button"
          className="btn-danger"
          disabled={isDeclaring}
          onClick={onRejectClick}
        >
          不採用を確定
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={isDeclaring}
          onClick={() => setRejectConfirmOpen(false)}
        >
          キャンセル
        </button>
      </div>
    </div>
  ) : null;
  const composerSelectKind: ComposerKind =
    composerKind === "proposal" && !canPropose ? "comment" : composerKind;
  const composerKindOptions: ReadonlyArray<readonly [ComposerKind, string]> = [
    ...(canPropose ? ([["proposal", "案"]] as const) : []),
    ...(canCompose ? COMPOSER_POST_TYPES : []),
    ...(canClaimWork ? ([["work_claim", "着手"]] as const) : []),
    ...(showRejectWhileDiscussing ? ([["reject", "不採用"]] as const) : []),
  ];
  const composerKindValues = composerKindOptions.map(([value]) => value);
  const activeComposerKind = composerKindValues.includes(composerSelectKind)
    ? composerSelectKind
    : (composerKindValues[0] ?? "comment");
  const isProposing = activeComposerKind === "proposal";
  const isClaimingWork = activeComposerKind === "work_claim";
  const isRejecting = activeComposerKind === "reject";
  const needsRationale =
    activeComposerKind === "objection" || activeComposerKind === "approval";
  const showComposer = canCompose || canClaimWork;
  const composerHeading = isProposing
    ? "案を出す"
    : isClaimingWork
      ? "着手を表明する"
      : isRejecting
        ? "不採用にする"
        : "投稿する";
  const composerSubmitLabel = isProposing
    ? "案を出す"
    : isClaimingWork
      ? "着手を表明"
      : isRejecting
        ? "不採用"
        : "投稿する";
  const showComplete = canCompleteThread(view.thread);
  const showOwnerDecide = discussing && isThreadOwner && !isBrainstorm;
  const showTiming =
    awaiting &&
    Boolean(view.thread.timingEndsAt || view.consensusReasons.length > 0);
  const hasThreadActions =
    Boolean(error) ||
    showComplete ||
    showTiming ||
    awaiting ||
    showOwnerDecide ||
    showComposer ||
    isProjectOwner;

  return (
    <article className="thread-page">
      <Link to={projectPath(projectId, "queue")} className="back-link">
        判断キューへ
      </Link>
      <h1>{view.thread.title}</h1>
      <ThreadBadges
        type={view.thread.type}
        state={view.thread.state}
        consensusType={view.thread.consensusType}
        workPhase={view.thread.workPhase}
        activeWorkClaimants={activeWorkClaimantNames(view.workClaims)}
      />
      {hasThreadActions ? (
        <section
          className="thread-actions"
          aria-label="このスレッドでの操作"
        >
          {error ? <p className="status status-error">{error}</p> : null}
          {showComplete ? (
            <div className="actions">
              <button
                type="button"
                className="btn-primary"
                disabled={isDeclaring}
                onClick={() => void runDeclare({ kind: "complete_thread" })}
              >
                完了にする
              </button>
            </div>
          ) : null}
          {showTiming ? (
            <div className="card">
              <h2>時間の合意</h2>
              {view.thread.timingEndsAt ? (
                <p className="muted">
                  期限:{" "}
                  <time dateTime={view.thread.timingEndsAt}>
                    {new Date(view.thread.timingEndsAt).toLocaleString("ja-JP")}
                  </time>
                </p>
              ) : null}
              {view.consensusReasons.length > 0 ? (
                <ul>
                  {view.consensusReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {awaiting ? (
            <form className="decision-panel" onSubmit={onRatify}>
              <label>
                <FieldCaption required>要約</FieldCaption>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  required
                />
              </label>
              <label>
                <FieldCaption>差し戻し理由</FieldCaption>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="actions">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isDeclaring}
                >
                  批准する
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isDeclaring || !reason.trim()}
                  onClick={onSendBack}
                >
                  差し戻す
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={isDeclaring || !summary.trim()}
                  onClick={onRejectClick}
                >
                  不採用
                </button>
              </div>
              {rejectConfirm}
            </form>
          ) : null}
          {showComposer ? (
            <form
              className="composer"
              onSubmit={(event) => {
                if (isProposing) {
                  void onAddProposal(event);
                  return;
                }
                if (isClaimingWork) {
                  void onClaimWork(event);
                  return;
                }
                if (isRejecting) {
                  event.preventDefault();
                  onRejectClick();
                  return;
                }
                void onPost(event, activeComposerKind as ComposerPostType);
              }}
            >
              <h2>{composerHeading}</h2>
              <div className="composer-kind-field">
                <FieldCaption required>種類</FieldCaption>
                <div className="composer-kinds" role="radiogroup" aria-label="種類">
                  {composerKindOptions.map(([value, label]) => (
                    <label key={value} className="composer-kind">
                      <input
                        type="radio"
                        name="composer-kind"
                        value={value}
                        checked={activeComposerKind === value}
                        onChange={() => {
                          setComposerKind(value);
                          setRejectConfirmOpen(false);
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              {isProposing ? (
                <>
                  {systemTemplates.length > 0 ? (
                    <TemplatePicker
                      label="ベースにするテンプレ"
                      templates={systemTemplates}
                      templateId={proposalTemplateId}
                      emptyLabel="選ばない（空のまま書く）"
                      requirement="optional"
                      onSelect={(id, content) => {
                        setProposalTemplateId(id);
                        if (content) {
                          setProposalContent(content);
                        }
                      }}
                    />
                  ) : null}
                  <label>
                    <FieldCaption required>内容</FieldCaption>
                    <textarea
                      value={proposalContent}
                      onChange={(event) =>
                        setProposalContent(event.target.value)
                      }
                      required
                    />
                  </label>
                  <p className="hint muted">
                    版を持つ議案になります。コメントや異議とは別に、合意の候補にできます。
                  </p>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={isDeclaring || !proposalContent.trim()}
                  >
                    案を出す
                  </button>
                </>
              ) : isClaimingWork ? (
                <>
                  <label>
                    <FieldCaption required>
                      paths（1 行 1 件。全部なら "."）
                    </FieldCaption>
                    <textarea
                      value={claimPathsText}
                      onChange={(event) => setClaimPathsText(event.target.value)}
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn-secondary"
                    disabled={isDeclaring || !claimPathsText.trim()}
                  >
                    着手を表明
                  </button>
                </>
              ) : isRejecting ? (
                <>
                  <label>
                    <FieldCaption required>不採用の理由</FieldCaption>
                    <textarea
                      value={summary}
                      onChange={(event) => setSummary(event.target.value)}
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn-danger"
                    disabled={isDeclaring || !summary.trim()}
                  >
                    不採用
                  </button>
                  {rejectConfirm}
                </>
              ) : (
                <>
                  <label>
                    <FieldCaption required>本文</FieldCaption>
                    <textarea
                      value={postBody}
                      onChange={(event) => setPostBody(event.target.value)}
                      required
                    />
                  </label>
                  {needsRationale ? (
                    <>
                      <label>
                        <FieldCaption required>根拠</FieldCaption>
                        <textarea
                          value={rationale}
                          onChange={(event) => setRationale(event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        <FieldCaption required>対象の提案</FieldCaption>
                        <select
                          value={targetVersionId}
                          onChange={(event) =>
                            setTargetVersionId(event.target.value)
                          }
                          required
                        >
                          <option value="">選ぶ</option>
                          {view.proposals.map((proposal) => (
                            <option
                              key={proposal.id}
                              value={proposal.latestVersionId}
                            >
                              #{proposal.number} v{proposal.versionNumber}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : null}
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={isDeclaring || !postBody.trim()}
                  >
                    {composerSubmitLabel}
                  </button>
                </>
              )}
            </form>
          ) : null}
          {showOwnerDecide ? (
            <form
              className="decision-panel"
              onSubmit={(event) => {
                event.preventDefault();
                if (!ownerSummary.trim()) {
                  return;
                }
                void runDeclare({
                  kind: "owner_decide",
                  binding: true,
                  summary: ownerSummary,
                });
              }}
            >
              <h2>オーナーの宣言</h2>
              <label>
                <FieldCaption required>要約</FieldCaption>
                <textarea
                  value={ownerSummary}
                  onChange={(event) => setOwnerSummary(event.target.value)}
                  required
                />
              </label>
              <div className="actions">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isDeclaring || !ownerSummary.trim()}
                >
                  オーナー決定
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isDeclaring || !ownerSummary.trim()}
                  onClick={() =>
                    void runDeclare({
                      kind: "declare_rough",
                      binding: true,
                      summary: ownerSummary,
                    })
                  }
                >
                  ラフを宣言
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isDeclaring}
                  onClick={() =>
                    void runDeclare({ kind: "request_ratification" })
                  }
                >
                  人間批准へ
                </button>
              </div>
            </form>
          ) : null}
          {isProjectOwner ? (
            <section className="danger-zone">
              <h2>危険な操作</h2>
              {hasBindingAgreement ? (
                <p className="muted">
                  拘束的な有効合意があるため、このスレッドは削除できません。
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={isDeclaring}
                    onClick={() => requestDeleteThread()}
                  >
                    スレッドを削除
                  </button>
                  {threadDeleteConfirm ? (
                    <div
                      className="decision-confirm"
                      role="group"
                      aria-label="スレッド削除の確認"
                    >
                      <p>このスレッドを削除します。元に戻せません。</p>
                      <div className="actions">
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={isDeclaring}
                          onClick={() => void confirmDeleteThread()}
                        >
                          削除を確定
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setThreadDeleteConfirm(false)}
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}
        </section>
      ) : null}
      <SynthesisCard
        synthesis={view.synthesis}
        candidate={view.candidateProposal}
      />
      {view.proposals.length > 0 ? (
        <>
          <h2>提案</h2>
          <ul className="proposal-list">
            {view.proposals.map((proposal) => {
              const isCandidate =
                view.candidateProposal?.id === proposal.latestVersionId;
              return (
                <li key={proposal.id} className="proposal-card">
                  <p className="muted">
                    提案 #{proposal.number} / v{proposal.versionNumber}
                  </p>
                  <MarkdownBody source={proposal.content} />
                  {discussing && canSelectCandidate ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isDeclaring}
                      onClick={() =>
                        void runDeclare({
                          kind: "select_candidate",
                          proposalVersionId: proposal.latestVersionId,
                        })
                      }
                    >
                      これを候補にする
                    </button>
                  ) : null}
                  {isProjectOwner ? (
                    <div className="proposal-delete">
                      {isCandidate ? (
                        <p className="muted">
                          候補中の提案です。削除するには先に候補を外してください。
                        </p>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn-danger"
                            disabled={isDeclaring}
                            onClick={() => requestDeleteProposal(proposal.id)}
                          >
                            この案を削除
                          </button>
                          {proposalDeleteConfirm &&
                          proposalDeleteId === proposal.id ? (
                            <div
                              className="decision-confirm"
                              role="group"
                              aria-label="提案削除の確認"
                            >
                              <p>この案を削除します</p>
                              <div className="actions">
                                <button
                                  type="button"
                                  className="btn-danger"
                                  disabled={isDeclaring}
                                  onClick={() =>
                                    void confirmDeleteProposal(proposal.id)
                                  }
                                >
                                  削除を確定
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => {
                                    setProposalDeleteConfirm(false);
                                    setProposalDeleteId(null);
                                  }}
                                >
                                  キャンセル
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {view.pullRequests.length > 0 ? (
        <>
          <h2>リンク済み PR</h2>
          <ul>
            {view.pullRequests.map((pr) => (
              <li key={pr.number}>
                #{pr.number} {pullRequestStateLabel(pr.state)}{" "}
                <a href={pr.url}>GitHub</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {view.workClaims.length > 0 ? (
        <>
          <h2>着手</h2>
          <ul>
            {view.workClaims.map((claim) => (
              <li key={claim.id}>
                {claim.displayName}: {claim.paths.join(", ")}{" "}
                <time
                  className="muted"
                  dateTime={claim.createdAt}
                  title={claim.createdAt}
                >
                  {formatRelativeTimeJa(claim.createdAt)}
                </time>{" "}
                {me?.participant.id === claim.participantId ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isDeclaring}
                    onClick={() => void onReleaseWork(claim.id)}
                  >
                    解除
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {view.decisionView ? (
        <div className="card">
          <h2>決まったこと</h2>
          <p className="muted">活動量 {view.decisionView.activitySpent}</p>
          {view.decisionView.diff ? (
            <>
              <p className="muted">前版との差</p>
              <pre>{view.decisionView.diff}</pre>
            </>
          ) : null}
          {view.decisionView.previousAgreement ? (
            <>
              <p className="muted">前の合意との差</p>
              <pre>{view.decisionView.previousAgreement.summaryDiff}</pre>
            </>
          ) : null}
        </div>
      ) : null}
      <h2>投稿</h2>
      <ol className="minutes-list">
        {sortThreadPostsByCreatedAtDesc(view.posts).map((post) => (
          <li key={post.id} className="minutes-item">
            <div className="minutes-meta">
              <span className="minutes-author">{post.authorDisplayName}</span>
              <PostTypeBadge type={post.type} />
              <time
                className="muted"
                dateTime={post.createdAt}
                title={post.createdAt}
              >
                {formatRelativeTimeJa(post.createdAt)}
              </time>
            </div>
            <MarkdownBody source={post.body} />
          </li>
        ))}
      </ol>
      <ThreadJumpButtons />
    </article>
  );
}

function ThreadJumpButtons() {
  return (
    <div className="thread-jump" role="group" aria-label="ページ内移動">
      <button
        type="button"
        className="thread-jump-btn"
        aria-label="先頭へ"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      >
        ↑
      </button>
      <button
        type="button"
        className="thread-jump-btn"
        aria-label="末尾へ"
        onClick={() =>
          window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: "smooth",
          })
        }
      >
        ↓
      </button>
    </div>
  );
}
