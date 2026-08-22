import type { PullRequestState } from "@comitia/shared";

export type PullRequestSnapshot = {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  state: PullRequestState;
};

export interface GitHubClient {
  getPullRequest(input: {
    installationId: string;
    owner: string;
    repo: string;
    number: number;
  }): Promise<PullRequestSnapshot>;
  commentAndCloseIssue(input: {
    installationId: string;
    owner: string;
    repo: string;
    number: number;
    body: string;
  }): Promise<void>;
  exchangeOAuthCode(code: string): Promise<{ accessToken: string }>;
  getUser(accessToken: string): Promise<{ id: string; login: string }>;
  listInstallationRepos(installationId: string): Promise<
    Array<{ owner: string; repo: string }>
  >;
  listInstallations(): Promise<Array<{ id: string }>>;
}
