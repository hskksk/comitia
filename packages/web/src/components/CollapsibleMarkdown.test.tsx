import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CollapsibleMarkdown } from "./CollapsibleMarkdown.js";

describe("CollapsibleMarkdown", () => {
  afterEach(cleanup);

  const source = ["alpha", "", "beta", "", "gamma", "", "delta", "", "epsilon", "", "zeta"].join(
    "\n",
  );

  it("shows only the first preview lines until expanded", () => {
    render(<CollapsibleMarkdown source={source} previewLines={5} />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("zeta")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "続き" })).toBeInTheDocument();
  });

  it("expands when the preview is clicked", () => {
    render(<CollapsibleMarkdown source={source} previewLines={5} />);

    fireEvent.click(screen.getByText("gamma"));

    expect(screen.getByText("zeta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument();
  });

  it("renders preformatted source when as=pre", () => {
    render(
      <CollapsibleMarkdown
        as="pre"
        className="trace-entry-body"
        source={'{\n  "foo": "bar"\n}'}
      />,
    );

    const pre = document.querySelector("pre.trace-entry-body");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('"foo": "bar"');
  });
});
