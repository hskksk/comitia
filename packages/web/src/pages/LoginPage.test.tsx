import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { getToken } from "../auth.js";
import { LoginPage } from "./LoginPage.js";

const meMock = vi.fn().mockRejectedValue(new Error("unauthorized"));

vi.mock("../api.js", () => ({
  boardClient: {
    me: (...args: unknown[]) => meMock(...args),
  },
}));

describe("LoginPage", () => {
  it("clears the stored token when login fails", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("オーナートークン"), "bad-token");
    await user.click(screen.getByRole("button", { name: "入る" }));

    await screen.findByText(/トークンが無効です/);
    expect(getToken()).toBeNull();
  });
});
