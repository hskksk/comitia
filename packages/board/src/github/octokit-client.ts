import { App } from "@octokit/app";
import {
  AGENT_GITHUB_TOKEN_PERMISSIONS,
  type GitHubClient,
} from "./types.js";
import {
  AGENT_GITHUB_PERMISSIONS_MISSING_ERROR,
  installationGrantsAgentTokenPermissions,
  sameGithubRepo,
} from "./mint-error.js";
import { mapPullRequestState } from "./map-pr-state.js";
import type { readGitHubConfig } from "./config.js";

export function createOctokitGitHubClient(
  config: ReturnType<typeof readGitHubConfig>,
): GitHubClient {
  if (
    !config.appId ||
    !config.privateKey ||
    !config.clientId ||
    !config.clientSecret
  ) {
    throw new Error("GitHub App env is incomplete");
  }

  const app = new App({
    appId: config.appId,
    privateKey: config.privateKey,
    oauth: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    },
  });

  return {
    async getPullRequest(input) {
      const octokit = await app.getInstallationOctokit(
        Number(input.installationId),
      );
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner: input.owner,
          repo: input.repo,
          pull_number: input.number,
        },
      );
      return {
        owner: input.owner,
        repo: input.repo,
        number: data.number,
        url: data.html_url,
        title: data.title,
        state: mapPullRequestState({
          state: data.state,
          merged: data.merged_at !== null,
        }),
      };
    },

    async commentAndCloseIssue(input) {
      const octokit = await app.getInstallationOctokit(
        Number(input.installationId),
      );
      await octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: input.owner,
          repo: input.repo,
          issue_number: input.number,
          body: input.body,
        },
      );
      await octokit.request(
        "PATCH /repos/{owner}/{repo}/issues/{issue_number}",
        {
          owner: input.owner,
          repo: input.repo,
          issue_number: input.number,
          state: "closed",
        },
      );
    },

    async exchangeOAuthCode(code) {
      const auth = await app.oauth.createToken({ code });
      return { accessToken: auth.authentication.token };
    },

    async getUser(accessToken) {
      const octokit = await app.oauth.getUserOctokit({ token: accessToken });
      const { data } = await octokit.request("GET /user");
      return { id: String(data.id), login: data.login };
    },

    async listInstallationRepos(installationId) {
      const octokit = await app.getInstallationOctokit(Number(installationId));
      const { data } = await octokit.request("GET /installation/repositories", {
        per_page: 100,
      });
      return data.repositories.map((repo) => ({
        owner: repo.owner.login,
        repo: repo.name,
      }));
    },

    async listInstallations() {
      const { data } = await app.octokit.request("GET /app/installations", {
        per_page: 100,
      });
      return data.map((installation) => ({ id: String(installation.id) }));
    },

    async createInstallationAccessToken(input) {
      const installationId = Number(input.installationId);
      if (!Number.isFinite(installationId)) {
        throw new Error("invalid GitHub App installation id");
      }
      const { data: installation } = await app.octokit.request(
        "GET /app/installations/{installation_id}",
        { installation_id: installationId },
      );
      if (!installationGrantsAgentTokenPermissions(installation.permissions)) {
        throw new Error(AGENT_GITHUB_PERMISSIONS_MISSING_ERROR);
      }
      const repos = await this.listInstallationRepos(input.installationId);
      const included = repos.some((row) => sameGithubRepo(row, input));
      if (!included) {
        throw new Error(
          `installation ${input.installationId} does not include ${input.owner}/${input.repo}`,
        );
      }
      const { data } = await app.octokit.request(
        "POST /app/installations/{installation_id}/access_tokens",
        {
          installation_id: installationId,
          repositories: [input.repo],
          permissions: { ...AGENT_GITHUB_TOKEN_PERMISSIONS },
        },
      );
      return {
        token: data.token,
        expiresAt: new Date(data.expires_at),
      };
    },
  };
}
