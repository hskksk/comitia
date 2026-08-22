import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boardClient, type AgreementItem } from "../api.js";
import { MarkdownBody } from "../components/MarkdownBody.js";
import { projectPath } from "../projectContext.js";
import { useFocusPoll } from "../useFocusPoll.js";
import { useRouteLoad } from "../useRouteLoad.js";

export function AgreementsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [items, setItems] = useState<AgreementItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setItems(null);
    setError(null);
  }, []);

  const load = useCallback(() => {
    boardClient
      .agreements()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  useRouteLoad(load, [projectId], reset);
  useFocusPoll(load, 20_000);

  if (!projectId) {
    return null;
  }
  if (error) {
    return <p className="status status-error">{error}</p>;
  }
  if (!items) {
    return <p className="status status-loading">読み込み中…</p>;
  }
  if (items.length === 0) {
    return <p className="status status-empty">有効な合意はまだありません</p>;
  }

  return (
    <section>
      <h1>提案集</h1>
      {items.map((item) => (
        <article key={item.id} className="card">
          <MarkdownBody source={item.proposalContent} />
          <footer className="muted">
            <p>
              スレッド:{" "}
              <Link to={projectPath(projectId, `threads/${item.threadId}`)}>
                {item.threadTitle ?? "スレッド"}
              </Link>
              {" ・ "}
              {item.binding ? "拘束力あり" : "拘束力なし"}
            </p>
            {item.summary ? (
              <p className="agreement-summary">{item.summary}</p>
            ) : null}
          </footer>
        </article>
      ))}
    </section>
  );
}
