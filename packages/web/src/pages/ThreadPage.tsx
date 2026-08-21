import { type FormEvent, useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  boardClient,
  type HumanThreadView,
  type MeResponse,
} from "../api.js";
import { PostTypeBadge, ThreadBadges } from "../components/Badges.js";
import { MarkdownBody } from "../components/MarkdownBody.js";
import { SynthesisCard } from "../components/SynthesisCard.js";
import {
  TemplatePicker,
  type SystemTemplateItem,
} from "../components/TemplatePicker.js";
import { pullRequestStateLabel } from "../labels.js";
import { projectPath } from "../projectContext.js";
import { formatRelativeTimeJa } from "../relativeTime.js";
import { useRouteLoad } from "../useRouteLoad.js";

const COMPOSER_TYPES = [
  ["comment", "コメント"],
  ["question", "質問"],
  ["position", "意見"],
  ["objection", "異議"],
  ["approval", "承認"],
  ["synthesis", "統合"],
  ["report", "報告"],
] as const;

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
  const [postType, setPostType] = useState<(typeof COMPOSER_TYPES)[number][0]>(
    "comment",
  );
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
    setPostType("comment");
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

  async function onPost(event: FormEvent) {
    event.preventDefault();
    if (!id || !postBody.trim()) {
      return;
    }
    const needsRationale = postType === "objection" || postType === "approval";
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
  const canCompose = discussing || awaiting;
  const isThreadOwner = me?.participant.id === view.thread.ownerParticipantId;
  const isProjectOwner = me?.participant.id === projectOwnerId;
  const needsRationale = postType === "objection" || postType === "approval";
  const canClaimWork =
    view.thread.state !== "completed" && view.thread.state !== "rejected";

  return (
    <article>
      <Link to={projectPath(projectId, "queue")} className="back-link">
        判断キューへ
      </Link>
      <h1>{view.thread.title}</h1>
      <ThreadBadges
        type={view.thread.type}
        state={view.thread.state}
        consensusType={view.thread.consensusType}
      />
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
                  {discussing && isThreadOwner ? (
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
      {canClaimWork ? (
        <form className="composer" onSubmit={onClaimWork}>
          <h2>着手を表明する</h2>
          <label>
            paths（1 行 1 件。全部なら "."）
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
        </form>
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
        {view.posts.map((post) => (
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
      {canCompose ? (
        <>
          <form className="composer" onSubmit={onPost}>
            <h2>投稿する</h2>
            <label>
              型
              <select
                value={postType}
                onChange={(event) =>
                  setPostType(event.target.value as (typeof COMPOSER_TYPES)[number][0])
                }
              >
                {COMPOSER_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              本文
              <textarea
                value={postBody}
                onChange={(event) => setPostBody(event.target.value)}
                required
              />
            </label>
            {needsRationale ? (
              <>
                <label>
                  根拠
                  <textarea
                    value={rationale}
                    onChange={(event) => setRationale(event.target.value)}
                    required
                  />
                </label>
                <label>
                  対象の提案
                  <select
                    value={targetVersionId}
                    onChange={(event) => setTargetVersionId(event.target.value)}
                    required
                  >
                    <option value="">選ぶ</option>
                    {view.proposals.map((proposal) => (
                      <option key={proposal.id} value={proposal.latestVersionId}>
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
              投稿する
            </button>
          </form>
          <form className="composer" onSubmit={onAddProposal}>
            <h2>案を出す</h2>
            {systemTemplates.length > 0 ? (
              <TemplatePicker
                label="ベースにするテンプレ"
                templates={systemTemplates}
                templateId={proposalTemplateId}
                emptyLabel="選ばない（空のまま書く）"
                onSelect={(id, content) => {
                  setProposalTemplateId(id);
                  if (content) {
                    setProposalContent(content);
                  }
                }}
              />
            ) : null}
            <label>
              内容
              <textarea
                value={proposalContent}
                onChange={(event) => setProposalContent(event.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="btn-secondary"
              disabled={isDeclaring || !proposalContent.trim()}
            >
              案を出す
            </button>
          </form>
        </>
      ) : null}
      {discussing && isThreadOwner ? (
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
            要約
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
              onClick={() => void runDeclare({ kind: "request_ratification" })}
            >
              人間批准へ
            </button>
          </div>
        </form>
      ) : null}
      {awaiting && (view.thread.timingEndsAt || view.consensusReasons.length > 0) ? (
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
            要約
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              required
            />
          </label>
          <label>
            差し戻し理由
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
          {rejectConfirmOpen ? (
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
          ) : null}
        </form>
      ) : null}
      {view.thread.state === "decided" &&
      (view.thread.type === "implementation" || view.thread.type === "review") ? (
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
                <div className="decision-confirm" role="group" aria-label="スレッド削除の確認">
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
      {error ? <p className="status status-error">{error}</p> : null}
    </article>
  );
}
