import { describe, expect, it } from "vitest";
import {
  AGENT_GITHUB_PERMISSIONS_MISSING_ERROR,
  installationGrantsAgentTokenPermissions,
  publicMintError,
  sameGithubRepo,
} from "./mint-error.js";

describe("installationGrantsAgentTokenPermissions", () => {
  it("requires contents write and pull_requests write", () => {
    expect(
      installationGrantsAgentTokenPermissions({
        contents: "write",
        pull_requests: "write",
      }),
    ).toBe(true);
    expect(
      installationGrantsAgentTokenPermissions({
        contents: "read",
        pull_requests: "write",
      }),
    ).toBe(false);
    expect(
      installationGrantsAgentTokenPermissions({
        pull_requests: "read",
      }),
    ).toBe(false);
  });
});

describe("sameGithubRepo", () => {
  it("compares owner and repo case-insensitively", () => {
    expect(
      sameGithubRepo(
        { owner: "Hskksk", repo: "Comitia" },
        { owner: "hskksk", repo: "comitia" },
      ),
    ).toBe(true);
  });
});

describe("publicMintError", () => {
  it("maps GitHub 422 permission failures to the App permission hint", () => {
    expect(
      publicMintError({
        response: {
          data: {
            message: "Validation Failed",
            errors: ["The permissions requested are not granted to this installation."],
          },
        },
      }),
    ).toBe(AGENT_GITHUB_PERMISSIONS_MISSING_ERROR);
  });

  it("passes through installation coverage errors", () => {
    expect(
      publicMintError(
        new Error("installation 42 does not include hskksk/comitia"),
      ),
    ).toBe("installation 42 does not include hskksk/comitia");
  });

  it("hides unknown errors", () => {
    expect(publicMintError(new Error("boom"))).toBe(
      "failed to mint GitHub credentials",
    );
  });

  it("maps GitHub 404 to installation not found", () => {
    expect(publicMintError({ status: 404, message: "Not Found" })).toBe(
      "GitHub App installation not found",
    );
  });
});
