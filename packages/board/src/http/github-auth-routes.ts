import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Hono } from "hono";
import { githubOauthStates } from "../db/schema.js";
import type { Db } from "../db/types.js";
import {
  bindGithubIdentity,
  findHumanByGithubUserId,
  findUnboundSingleHuman,
  issueOrRotateIdentityToken,
  registerHuman,
} from "../domain/accounts.js";
import { recordEvent } from "../domain/events.js";
import type { GitHubClient } from "../github/types.js";
import type { BoardEnv } from "./auth.js";
import {
  requireAuth,
  requireHuman,
  requireProjectMember,
  requireProjectOwner,
} from "./auth.js";
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
  const human = requireHuman();
  const member = requireProjectMember(input.db);
  const projectOwner = requireProjectOwner(input.db);

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
    url.searchParams.set("allow_signup", "true");
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

    let humanRow = await findHumanByGithubUserId(input.db, user.id);
    if (!humanRow) {
      const unbound = await findUnboundSingleHuman(input.db);
      if (unbound) {
        await bindGithubIdentity(input.db, {
          participantId: unbound.id,
          githubUserId: user.id,
          githubLogin: user.login,
        });
        await recordEvent(input.db, {
          actorParticipantId: unbound.id,
          kind: "github_owner_bound",
          payload: { githubUserId: user.id, githubLogin: user.login },
        });
        humanRow = {
          ...unbound,
          githubUserId: user.id,
          githubLogin: user.login,
        };
      } else {
        const created = await registerHuman(input.db, {
          displayName: user.login,
          githubUserId: user.id,
          githubLogin: user.login,
          ignoreSignupGate: true,
        });
        const origin = new URL(c.req.url).origin;
        return c.redirect(`${origin}/login/callback?token=${created.token}`, 302);
      }
    }

    const token = await issueOrRotateIdentityToken(input.db, humanRow.id);
    const origin = new URL(c.req.url).origin;
    return c.redirect(`${origin}/login/callback?token=${token}`, 302);
  });

  app.get("/v1/github/install", auth, human, member, projectOwner, (c) => {
    if (!input.appSlug) {
      return c.json({ error: "GitHub App is not configured" }, 503);
    }
    return c.redirect(
      `https://github.com/apps/${input.appSlug}/installations/new`,
      302,
    );
  });

  app.get("/v1/github/setup", auth, human, member, projectOwner, async (c) => {
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
    return c.redirect(`${origin}/p/${projectId}/settings`, 302);
  });
}

export function hashOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}
