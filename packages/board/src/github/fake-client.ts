import type { PullRequestSnapshot } from "./types.js";
import type { GitHubClient } from "./types.js";

export type FakeGitHubIssueAction = {
  owner: string;
  repo: string;
  number: number;
  body: string;
  closed: boolean;
};

export type FakeGitHubClientSeed = {
  pullRequests?: PullRequestSnapshot[];
  installationRepos?: Record<string, Array<{ owner: string; repo: string }>>;
  oauthCodes?: Record<string, { accessToken: string }>;
  users?: Record<string, { id: string; login: string }>;
};

export type FakeGitHubClient = GitHubClient & {
  pullRequests: Map<string, PullRequestSnapshot>;
  issueActions: FakeGitHubIssueAction[];
  setPullRequest(pr: PullRequestSnapshot): void;
};

function prKey(owner: string, repo: string, number: number) {
  return `${owner}/${repo}#${number}`;
}

export function createFakeGitHubClient(
  seed?: FakeGitHubClientSeed,
): FakeGitHubClient {
  const pullRequests = new Map<string, PullRequestSnapshot>();
  for (const pr of seed?.pullRequests ?? []) {
    pullRequests.set(prKey(pr.owner, pr.repo, pr.number), { ...pr });
  }

  const installationRepos = new Map(
    Object.entries(seed?.installationRepos ?? {}),
  );
  const oauthCodes = seed?.oauthCodes ?? {};
  const users = seed?.users ?? {};
  const issueActions: FakeGitHubIssueAction[] = [];

  const client: FakeGitHubClient = {
    pullRequests,
    issueActions,

    setPullRequest(pr) {
      pullRequests.set(prKey(pr.owner, pr.repo, pr.number), { ...pr });
    },

    async getPullRequest(input) {
      const pr = pullRequests.get(
        prKey(input.owner, input.repo, input.number),
      );
      if (!pr) {
        throw new Error(`pull request not found: ${input.number}`);
      }
      return { ...pr };
    },

    async commentAndCloseIssue(input) {
      issueActions.push({
        owner: input.owner,
        repo: input.repo,
        number: input.number,
        body: input.body,
        closed: true,
      });
    },

    async exchangeOAuthCode(code) {
      const entry = oauthCodes[code];
      if (!entry) {
        throw new Error(`unknown oauth code: ${code}`);
      }
      return { accessToken: entry.accessToken };
    },

    async getUser(accessToken) {
      const user = users[accessToken];
      if (!user) {
        throw new Error(`unknown access token`);
      }
      return user;
    },

    async listInstallationRepos(installationId) {
      return installationRepos.get(installationId) ?? [];
    },

    async listInstallations() {
      return [...installationRepos.keys()].map((id) => ({ id }));
    },
  };

  return client;
}
