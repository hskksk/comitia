import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { bootstrapBoard } from "../domain/bootstrap.js";
import { authenticateToken } from "../domain/credentials.js";
import { createBoardApp } from "../http/app.js";
import { ensurePreviewBootstrap } from "./bootstrap.js";
import { readPreviewAuthConfig } from "./config.js";
import {
  derivePreviewBootstrapToken,
  isRailwayPrPreviewEnvironment,
} from "./railway.js";

const PREVIEW_TOKEN = `comt_${"a".repeat(64)}`;

describe("preview auth railway detection", () => {
  it("detects PR deploys from a non-main branch", () => {
    expect(
      isRailwayPrPreviewEnvironment({
        RAILWAY_ENVIRONMENT_ID: "env-pr",
        RAILWAY_ENVIRONMENT_NAME: "cursor-login-preview-auth-6407",
        RAILWAY_GIT_BRANCH: "cursor/login-preview-auth-6407",
      }),
    ).toBe(true);
  });

  it("does not auto-enable on production", () => {
    expect(
      isRailwayPrPreviewEnvironment({
        RAILWAY_ENVIRONMENT_ID: "env-prod",
        RAILWAY_ENVIRONMENT_NAME: "production",
        RAILWAY_GIT_BRANCH: "main",
      }),
    ).toBe(false);
  });

  it("does not auto-enable on persistent staging", () => {
    expect(
      isRailwayPrPreviewEnvironment({
        RAILWAY_ENVIRONMENT_ID: "env-staging",
        RAILWAY_ENVIRONMENT_NAME: "staging",
        RAILWAY_GIT_BRANCH: "main",
      }),
    ).toBe(false);
  });

  it("derives a stable bootstrap token from Railway env + database URL", () => {
    const token = derivePreviewBootstrapToken({
      environmentId: "env-pr-1",
      databaseUrl: "postgres://u:p@host/db",
    });
    expect(token).toMatch(/^comt_[0-9a-f]{64}$/);
    expect(token).toBe(
      derivePreviewBootstrapToken({
        environmentId: "env-pr-1",
        databaseUrl: "postgres://u:p@host/db",
      }),
    );
  });
});

describe("preview auth config", () => {
  it("accepts a valid explicit bootstrap token", () => {
    expect(
      readPreviewAuthConfig({
        COMITIA_BOOTSTRAP_TOKEN: PREVIEW_TOKEN,
      }),
    ).toEqual({
      enabled: true,
      autoPreview: false,
      bootstrapToken: PREVIEW_TOKEN,
      ownerDisplayName: "Preview",
      projectName: "preview",
    });
  });

  it("auto-derives bootstrap token for Railway PR environments", () => {
    const config = readPreviewAuthConfig({
      RAILWAY_ENVIRONMENT_ID: "env-pr-1",
      RAILWAY_ENVIRONMENT_NAME: "pr-128",
      RAILWAY_GIT_BRANCH: "cursor/login-preview-auth-6407",
      DATABASE_URL: "postgres://u:p@host/db",
    });
    expect(config.enabled).toBe(true);
    expect(config.autoPreview).toBe(true);
    expect(config.bootstrapToken).toBe(
      derivePreviewBootstrapToken({
        environmentId: "env-pr-1",
        databaseUrl: "postgres://u:p@host/db",
      }),
    );
    expect(config.projectName).toBe("cursor.login-preview-auth-6407");
  });

  it("ignores malformed explicit bootstrap tokens", () => {
    expect(
      readPreviewAuthConfig({
        COMITIA_BOOTSTRAP_TOKEN: "not-a-token",
      }).enabled,
    ).toBe(false);
  });
});

describe("preview auth bootstrap", () => {
  it("bootstraps an empty board with the configured token", async () => {
    await ensurePreviewBootstrap(db, {
      enabled: true,
      autoPreview: true,
      bootstrapToken: PREVIEW_TOKEN,
      ownerDisplayName: "Preview",
      projectName: "preview",
    });

    const auth = await authenticateToken(db, PREVIEW_TOKEN);
    expect(auth?.participant.displayName).toBe("Preview");
  });

  it("does nothing when the board is already initialized", async () => {
    await bootstrapBoard(db, {
      ownerDisplayName: "Existing",
      projectName: "existing",
    });

    await ensurePreviewBootstrap(db, {
      enabled: true,
      autoPreview: true,
      bootstrapToken: PREVIEW_TOKEN,
      ownerDisplayName: "Preview",
      projectName: "preview",
    });

    const auth = await authenticateToken(db, PREVIEW_TOKEN);
    expect(auth).toBeNull();
  });
});

describe("preview auth routes", () => {
  function app() {
    return createBoardApp({
      db,
      previewAuth: {
        enabled: true,
        bootstrapToken: PREVIEW_TOKEN,
      },
    });
  }

  it("exposes preview login in auth config", async () => {
    const res = await app().request("/v1/auth/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      githubOAuth: false,
      previewLogin: true,
    });
  });

  it("returns the bootstrap token after preview bootstrap", async () => {
    await ensurePreviewBootstrap(db, {
      enabled: true,
      autoPreview: true,
      bootstrapToken: PREVIEW_TOKEN,
      ownerDisplayName: "Preview",
      projectName: "preview",
    });

    const res = await app().request("/v1/auth/preview-login", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: PREVIEW_TOKEN });
  });

  it("rejects preview login before bootstrap is ready", async () => {
    const res = await app().request("/v1/auth/preview-login", {
      method: "POST",
    });
    expect(res.status).toBe(503);
  });
});
