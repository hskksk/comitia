import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Hono } from "hono";
import { githubOauthStates } from "../db/schema.js";
import type { Db } from "../db/types.js";
import {
  bindGithubIdentity,
  findHumanByGithubUserId,
  findUnboundSingleHuman,
  issueIdentityToken,
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
import { connectExistingOrInstallUrl, connectInstallation } from "./github-routes.js";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function sanitizeLoginOrigin(
  candidate: string | null | undefined,
  publicBaseUrl?: string,
): string | null {
  if (!candidate) {
    return null;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (publicBaseUrl && url.origin === new URL(publicBaseUrl).origin) {
      return url.origin;
    }
    if (LOCAL_DEV_HOSTS.has(url.hostname)) {
      return url.origin;
    }
    return null;
  } catch {
    return null;
  }
}

export function encodeOauthState(returnOrigin: string | null): string {
  const nonce = randomBytes(24).toString("hex");
  if (!returnOrigin) {
    return nonce;
  }
  return `${nonce}.${Buffer.from(returnOrigin).toString("base64url")}`;
}

export function decodeOauthReturnOrigin(state: string): string | null {
  const separator = state.indexOf(".");
  if (separator === -1) {
    return null;
  }
  try {
    return Buffer.from(state.slice(separator + 1), "base64url").toString("utf8") || null;
  } catch {
    return null;
  }
}

function oauthCallbackBase(
  publicBaseUrl: string | undefined,
  requestUrl: string,
): string {
  return publicBaseUrl
    ? stripTrailingSlash(publicBaseUrl)
    : new URL(requestUrl).origin;
}

function loginCallbackLocation(
  token: string,
  state: string,
  publicBaseUrl: string | undefined,
  requestUrl: string,
): string {
  const fallback = oauthCallbackBase(publicBaseUrl, requestUrl);
  const origin =
    sanitizeLoginOrigin(decodeOauthReturnOrigin(state), publicBaseUrl) ??
    fallback;
  return `${origin}/login/callback?token=${token}`;
}

export function registerGithubAuthRoutes(
  app: Hono<BoardEnv>,
  input: {
    db: Db;
    github?: GitHubClient;
    oauthEnabled: boolean;
    appSlug?: string;
    clientId?: string;
    publicBaseUrl?: string;
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
    const returnOrigin = sanitizeLoginOrigin(
      c.req.query("return_origin"),
      input.publicBaseUrl,
    );
    const state = encodeOauthState(returnOrigin);
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);
    await input.db.insert(githubOauthStates).values({ state, expiresAt });
    const redirectUri = `${oauthCallbackBase(input.publicBaseUrl, c.req.url)}/v1/auth/github/callback`;
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
        return c.redirect(
          loginCallbackLocation(
            created.token,
            state,
            input.publicBaseUrl,
            c.req.url,
          ),
          302,
        );
      }
    }

    const token = await issueIdentityToken(input.db, humanRow.id);
    return c.redirect(
      loginCallbackLocation(token, state, input.publicBaseUrl, c.req.url),
      302,
    );
  });

  app.get("/v1/github/install", auth, human, member, projectOwner, (c) => {
    if (!input.appSlug) {
      return c.json({ error: "GitHub App is not configured" }, 503);
    }
    return c.json({
      url: `https://github.com/apps/${input.appSlug}/installations/new`,
    });
  });

  app.post("/v1/github/connect", auth, human, member, projectOwner, async (c) => {
    if (!input.github || !input.appSlug) {
      return c.json({ error: "GitHub App is not configured" }, 503);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      repoUrl?: string | null;
    };
    const result = await connectExistingOrInstallUrl(input.db, input.github, {
      projectId: c.get("projectId"),
      actorId: c.get("participant").id,
      appSlug: input.appSlug,
      repoUrl: body.repoUrl,
    });
    return c.json(result);
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
