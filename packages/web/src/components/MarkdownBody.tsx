import { renderMarkdown } from "../markdown.js";

export function MarkdownBody(props: { source: string; className?: string }) {
  const html = renderMarkdown(props.source);
  return (
    <div
      className={["markdown-body", props.className].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
