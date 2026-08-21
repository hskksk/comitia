import { useState, type KeyboardEvent } from "react";
import { MarkdownBody } from "./MarkdownBody.js";

const DEFAULT_PREVIEW_LINES = 8;

/** Collapse long markdown to the first N lines with a 「続き」 toggle. */
export function CollapsibleMarkdown(props: {
  source: string;
  previewLines?: number;
  className?: string;
}) {
  const limit = props.previewLines ?? DEFAULT_PREVIEW_LINES;
  const lines = props.source.split("\n");
  const needsCollapse = lines.length > limit;
  const [expanded, setExpanded] = useState(false);

  const shown =
    needsCollapse && !expanded
      ? lines.slice(0, limit).join("\n")
      : props.source;

  const isCollapsed = needsCollapse && !expanded;

  function expand() {
    setExpanded(true);
  }

  function toggleExpanded() {
    setExpanded((value) => !value);
  }

  function onPreviewKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isCollapsed) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      expand();
    }
  }

  return (
    <div className="collapse-block">
      <div
        className={isCollapsed ? "collapse-preview is-collapsed" : undefined}
        onClick={isCollapsed ? expand : undefined}
        onKeyDown={onPreviewKeyDown}
        role={isCollapsed ? "button" : undefined}
        tabIndex={isCollapsed ? 0 : undefined}
        aria-expanded={needsCollapse ? expanded : undefined}
      >
        <MarkdownBody source={shown} className={props.className} />
      </div>
      {needsCollapse ? (
        <button
          type="button"
          className="collapse-toggle"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleExpanded();
          }}
        >
          {expanded ? "閉じる" : "続き"}
        </button>
      ) : null}
    </div>
  );
}
