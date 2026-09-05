import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadBadges } from "./Badges.js";

describe("ThreadBadges", () => {
  afterEach(cleanup);

  it("uses work phase as the primary status on decided implementation threads", () => {
    render(
      <ThreadBadges
        type="implementation"
        state="decided"
        consensusType="owner_decision"
        workPhase="merged"
      />,
    );
    expect(screen.getByText("マージ済み")).toBeInTheDocument();
    expect(screen.getByText("決定済み")).toBeInTheDocument();
    expect(screen.getByText("実装")).toBeInTheDocument();
  });

  it("does not invent a work-phase badge when the phase is absent", () => {
    render(
      <ThreadBadges
        type="proposal"
        state="decided"
        consensusType="rough"
      />,
    );
    expect(screen.getByText("決定済み")).toBeInTheDocument();
    expect(screen.queryByText("未着手")).not.toBeInTheDocument();
    expect(screen.queryByText("レビュー中")).not.toBeInTheDocument();
  });
});
