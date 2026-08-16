import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Hono } from "hono";
import {
  agentCredentials,
  githubOauthStates,
  participants,
  projects,
} from "../db/schema.js";
import type { Db } from "../db/types.js";
import { hashToken, issueToken } from "../domain/credentials.js";
import { recordEvent } from "../domain/events.js";
import type { GitHubClient } from "../github/types.js";
import type { BoardEnv } from "./auth.js";
import { requireAuth, requireOwner } from "./auth.js";
import { connectInstallation } from "./github-routes.js";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function registerGithubAuthRoutes(
  app: Hono<BoardEnv>,
  input: {
    db: Db;
    github?: GitHubClient;
    oauthEnabled: boolean;
    appSlug?: string;
    clientId?: string;
  },
) {
  const auth = requireAuth(input.db);
  const owner = requireOwner();

  app.get("/v1/auth/config", (c) =>
    c.json({ githubOAuth: input.oauthEnabled }),
  );

  app.get("/v1/auth/github", async (c) => {
    if (!input.oauthEnabled || !input.clientId) {
      return c.json({ error: "GitHub OAuth is not configured" }, 503);
    }
    const state = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);
    await input.db.insert(githubOauthStates).values({ state, expiresAt });
    const origin = new URL(c.req.url).origin;
    const redirectUri = `${origin}/v1/auth/github/callback`;
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("allow_signup", "false");
    return c.redirect(url.toString(), 302);
  });

  app.get("/v1/auth/github/callback", async (c) => {
    if (!input.github || !input.oauthEnabled) {
      return c.json({ error: "GitHub OAuth is not configured" }, 503);
    }
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      return c.json({ error: "missing code or state" }, 400);
    }
    const now = new Date();
    const [stored] = await input.db
      .select()
      .from(githubOauthStates)
      .where(
        and(
          eq(githubOauthStates.state, state),
          gt(githubOauthStates.expiresAt, now),
        ),
      )
      .limit(1);
    if (!stored) {
      return c.json({ error: "invalid or expired state" }, 400);
    }
    await input.db
      .delete(githubOauthStates)
      .where(eq(githubOauthStates.state, state));

    const { accessToken } = await input.github.exchangeOAuthCode(code);
    const user = await input.github.getUser(accessToken);

    const humans = await input.db
      .select()
      .from(participants)
      .where(eq(participants.kind, "human"));
    const human = humans[0];
    if (!human) {
      return c.json({ error: "board is not initialized" }, 400);
    }

    if (human.githubUserId && human.githubUserId !== user.id) {
      return c.json({ error: "この GitHub アカウントでは入れません" }, 403);
    }

    if (!human.githubUserId) {
      await input.db
        .update(participants)
        .set({ githubUserId: user.id, githubLogin: user.login })
        .where(eq(participants.id, human.id));
      const [project] = await input.db
        .select()
        .from(projects)
        .where(eq(projects.ownerParticipantId, human.id))
        .limit(1);
      await recordEvent(input.db, {
        projectId: project?.id,
        actorParticipantId: human.id,
        kind: "github_owner_bound",
        payload: { githubUserId: user.id, githubLogin: user.login },
      });
    }

    const [project] = await input.db
      .select()
      .from(projects)
      .where(eq(projects.ownerParticipantId, human.id))
      .limit(1);
    if (!project) {
      return c.json({ error: "owner project not found" }, 400);
    }

    const token = issueToken();
    await input.db.insert(agentCredentials).values({
      participantId: human.id,
      projectId: project.id,
      tokenHash: hashToken(token),
    });

    const origin = new URL(c.req.url).origin;
    return c.redirect(`${origin}/login/callback?token=${token}`, 302);
  });

  app.get("/v1/github/install", auth, owner, (c) => {
    if (!input.appSlug) {
      return c.json({ error: "GitHub App is not configured" }, 503);
    }
    return c.redirect(
      `https://github.com/apps/${input.appSlug}/installations/new`,
      302,
    );
  });

  app.get("/v1/github/setup", auth, owner, async (c) => {
    if (!input.github) {
      return c.json({ error: "GitHub App is not configured" }, 503);
    }
    const installationId = c.req.query("installation_id");
    if (!installationId) {
      return c.json({ error: "installation_id is required" }, 400);
    }
    const projectId = c.get("projectId");
    await connectInstallation(input.db, input.github, {
      projectId,
      installationId,
      actorId: c.get("participant").id,
    });
    const origin = new URL(c.req.url).origin;
    return c.redirect(`${origin}/`, 302);
  });
}

export function hashOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}
