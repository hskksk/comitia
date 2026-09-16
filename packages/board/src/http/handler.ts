import { getRequestListener } from "@hono/node-server";
import { createPostgresDb } from "../db/postgres.js";
import { createBoardApp } from "./app.js";
import { registerCronRoutes } from "./cron-routes.js";
import { readGitHubConfig } from "../github/config.js";
import { createOctokitGitHubClient } from "../github/octokit-client.js";

/**
 * Railway Serverless (Functions) handler for comitia board.
 *
 * This handler processes HTTP requests in a serverless environment.
 * Background tasks (loops, scheduler) should be triggered via scheduled HTTP requests.
 */

let requestListener: ReturnType<typeof getRequestListener> | null = null;

async function initializeApp() {
  if (requestListener) {
    return requestListener;
  }

  const db = await createPostgresDb();
  const githubConfig = readGitHubConfig();
  const github = githubConfig
    ? createOctokitGitHubClient(githubConfig)
    : undefined;

  const app = createBoardApp({
    db,
    github,
  });

  // Register cron job endpoints for background tasks in serverless environment
  registerCronRoutes(app, { db });

  requestListener = getRequestListener(app);
  return requestListener;
}

export default async (req: Request): Promise<Response> => {
  const listener = await initializeApp();
  return listener(req);
};
