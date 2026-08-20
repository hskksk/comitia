import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { boardClient, type QueueItem } from "../api.js";
import { ThreadBadges } from "../components/Badges.js";
import { SynthesisCard } from "../components/SynthesisCard.js";
import { judgmentNeedLabel } from "../labels.js";
import { projectPath } from "../projectContext.js";

export function QueuePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const cardRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const navigate = useNavigate();

  useEffect(() => {
    boardClient
      .queue()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }, [projectId]);

  useEffect(() => {
    if (!items || items.length === 0) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "j") {
        event.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items!.length - 1));
      } else if (event.key === "k") {
        event.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = items![selectedIndex];
        if (item && projectId) {
          navigate(projectPath(projectId, `threads/${item.threadId}`));
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, selectedIndex, navigate, projectId]);

  useEffect(() => {
    const el = cardRefs.current[selectedIndex];
    el?.focus({ preventScroll: false });
  }, [selectedIndex, items]);

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
    return (
      <section>
        <h1>判断キュー</h1>
        <p className="status status-empty">判断待ちはありません</p>
        <p>
          <Link to={projectPath(projectId, "threads/new")}>
            提案する / 作業する
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1>判断キュー</h1>
      {items.map((item, index) => (
        <Link
          key={item.threadId}
          to={projectPath(projectId, `threads/${item.threadId}`)}
          className={`card${index === selectedIndex ? " is-selected" : ""}`}
          ref={(el) => {
            cardRefs.current[index] = el;
          }}
          tabIndex={index === selectedIndex ? 0 : -1}
          onFocus={() => setSelectedIndex(index)}
        >
          <h2>{item.title}</h2>
          <p className="card-need">{judgmentNeedLabel(item.consensusType)}</p>
          <ThreadBadges
            type={item.type}
            state={item.state}
            consensusType={item.consensusType}
          />
          <SynthesisCard
            synthesis={item.synthesis}
            candidate={item.candidateProposal}
            collapseCandidate
          />
        </Link>
      ))}
    </section>
  );
}
