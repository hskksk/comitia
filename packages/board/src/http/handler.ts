import { createPostgresDb } from "../db/postgres.js";
import { createBoardApp } from "./app.js";
import { readGitHubConfig } from "../github/config.js";
import { readPreviewAuthConfig } from "../preview-auth/config.js";
import { createOctokitGitHubClient } from "../github/octokit-client.js";

/**
 * Railway Serverless Handler
 *
 * Stateless HTTP request handler for serverless (Functions) execution.
 * Background tasks are triggered via external cron service calling HTTP endpoints.
 */

let app: ReturnType<typeof createBoardApp> | null = null;

async function initializeApp() {
  if (app) {
    return app;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const { db } = createPostgresDb(databaseUrl);
  const githubConfig = readGitHubConfig();
  const github = githubConfig
    ? createOctokitGitHubClient(githubConfig)
    : undefined;
  const previewAuthConfig = readPreviewAuthConfig();

  app = createBoardApp({
    db,
    github,
    githubOAuth: {
      enabled: !!githubConfig,
      appSlug: githubConfig?.appSlug,
      clientId: githubConfig?.clientId,
    },
    previewAuth: {
      enabled: !!previewAuthConfig,
      bootstrapToken: previewAuthConfig?.bootstrapToken,
    },
  });

  return app;
}

export default async (req: Request): Promise<Response> => {
  const application = await initializeApp();
  return application.fetch(req);
};
