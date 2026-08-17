import { useState } from "react";
import { MarkdownBody } from "./MarkdownBody.js";

const DEFAULT_PREVIEW_LINES = 8;

/** Collapse long markdown to the first N lines with a 「続き」 toggle. */
export function CollapsibleMarkdown(props: {
  source: string;
  previewLines?: number;
}) {
  const limit = props.previewLines ?? DEFAULT_PREVIEW_LINES;
  const lines = props.source.split("\n");
  const needsCollapse = lines.length > limit;
  const [expanded, setExpanded] = useState(false);

  const shown =
    needsCollapse && !expanded
      ? lines.slice(0, limit).join("\n")
      : props.source;

  return (
    <div className="collapse-block">
      <MarkdownBody source={shown} />
      {needsCollapse ? (
        <button
          type="button"
          className="collapse-toggle"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "閉じる" : "続き"}
        </button>
      ) : null}
    </div>
  );
}
