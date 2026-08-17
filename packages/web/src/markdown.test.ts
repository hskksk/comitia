import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("strips script tags", () => {
    const html = renderMarkdown('hello <script>alert("xss")</script> world');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("hello");
    expect(html).toContain("world");
  });

  it("keeps headings, lists, emphasis, and code", () => {
    const html = renderMarkdown(
      ["# Title", "", "- item", "", "**bold** and `code`", "", "```", "block", "```"].join(
        "\n",
      ),
    );
    expect(html).toMatch(/<h1>/);
    expect(html).toMatch(/<li>/);
    expect(html).toMatch(/<strong>/);
    expect(html).toMatch(/<code>/);
    expect(html).toMatch(/<pre>/);
  });
});
