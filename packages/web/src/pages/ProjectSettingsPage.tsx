import { type FormEvent, useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import {
  boardClient,
  type MeResponse,
  type ParticipantItem,
  type ProjectSummary,
} from "../api.js";
import { isProjectOwner } from "../projectContext.js";
import { useRouteLoad } from "../useRouteLoad.js";

export function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [members, setMembers] = useState<ParticipantItem[] | null>(null);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setMe(null);
    setProject(null);
    setMembers(null);
    setError(null);
    setInviteToken(null);
    setRemoveConfirmId(null);
  }, []);

  const reload = useCallback(() => {
    if (!projectId) {
      return;
    }
    return Promise.all([
      boardClient.me(),
      boardClient.getProject(projectId),
      boardClient.listMembers(projectId),
    ])
      .then(([identity, summary, memberRes]) => {
        setMe(identity);
        setProject(summary);
        setMembers(memberRes.items);
        setName(summary.name);
        setRepoUrl(summary.repoUrl ?? "");
      })
      .catch((err: Error) => setError(err.message));
  }, [projectId]);

  useRouteLoad(reload, [projectId], reset);

  if (!projectId) {
    return null;
  }
  if (error && !project) {
    return <p className="status status-error">{error}</p>;
  }
  if (!project || !me || !members) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  const owner = isProjectOwner(me, project);
  const ownerMember = members.find((m) => m.id === project.ownerParticipantId);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!owner || !projectId) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await boardClient.patchProject(projectId, {
        name: name.trim(),
        repoUrl: repoUrl.trim() === "" ? "" : repoUrl.trim(),
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function onCreateInvite() {
    if (!projectId) {
      return;
    }
    setError(null);
    try {
      const invite = await boardClient.createInvite(projectId);
      setInviteToken(invite.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "招待の発行に失敗しました");
    }
  }

  async function onInstallGitHubApp() {
    setError(null);
    try {
      const url = await boardClient.getGitHubInstallUrl();
      window.location.assign(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "GitHub App のインストールに失敗しました",
      );
    }
  }

  async function onRemoveMember(participantId: string) {
    if (!projectId) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await boardClient.removeMember(projectId, participantId);
      setRemoveConfirmId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "外しに失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h1>プロジェクト設定</h1>

      <form className="composer" onSubmit={onSave}>
        <h2>基本情報</h2>
        <label>
          名前
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            readOnly={!owner}
            required
          />
        </label>
        <label>
          リポジトリ URL（空でクリア）
          <input
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            readOnly={!owner}
            placeholder="https://github.com/org/repo"
          />
        </label>
        {owner ? (
          <button type="submit" className="btn-primary" disabled={saving}>
            保存する
          </button>
        ) : (
          <p className="muted">編集はプロジェクトオーナーのみ可能です</p>
        )}
      </form>

      <section className="composer">
        <h2>GitHub App</h2>
        {project.githubInstallationId ? (
          <>
            <p role="status">
              このプロジェクトに接続済み
              {project.githubOwner && project.githubRepo
                ? `（${project.githubOwner}/${project.githubRepo}）`
                : ""}
            </p>
            <p className="muted">
              App 本体はボード全体で共通です。別リポジトリのプロジェクトでは、そちらでも接続が必要です。
            </p>
          </>
        ) : (
          <>
            <p>このプロジェクトにはまだ接続されていません。</p>
            <p className="muted">
              GitHub App
              本体の作成はボード全体で一度で足ります。接続はプロジェクト（リポジトリ）ごとです。
            </p>
          </>
        )}
        {owner ? (
          <p>
            <button
              type="button"
              className="back-link"
              onClick={() => void onInstallGitHubApp()}
            >
              {project.githubInstallationId
                ? "再接続する"
                : "GitHub App をインストール"}
            </button>
          </p>
        ) : null}
      </section>

      <section className="composer">
        <h2>メンバー</h2>
        <p className="muted">
          オーナー: {ownerMember?.label ?? ownerMember?.displayName ?? "不明"}
        </p>
        <ul className="member-list">
          {members
            .filter((member) => member.kind === "human")
            .map((member) => (
              <li key={member.id} className="member-item">
                <span>{member.label ?? member.displayName}</span>
                {member.id === project.ownerParticipantId ? (
                  <span className="muted"> · オーナー</span>
                ) : owner && member.id !== me.participant.id ? (
                  <>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setRemoveConfirmId(member.id)}
                    >
                      外す
                    </button>
                    {removeConfirmId === member.id ? (
                      <div className="decision-confirm" role="group">
                        <p>このメンバーをプロジェクトから外します</p>
                        <div className="actions">
                          <button
                            type="button"
                            className="btn-danger"
                            disabled={saving}
                            onClick={() => void onRemoveMember(member.id)}
                          >
                            外すを確定
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setRemoveConfirmId(null)}
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
        </ul>

        {owner ? (
          <div className="actions">
            <button type="button" className="btn-secondary" onClick={() => void onCreateInvite()}>
              招待トークンを発行
            </button>
          </div>
        ) : null}
        {inviteToken ? (
          <div className="token-reveal" role="status">
            <p>
              <strong>招待トークン（一度だけ表示）</strong>
            </p>
            <code>{inviteToken}</code>
          </div>
        ) : null}
      </section>

      {error ? <p className="status status-error">{error}</p> : null}
    </section>
  );
}
