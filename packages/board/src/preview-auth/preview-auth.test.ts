import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { bootstrapBoard } from "../domain/bootstrap.js";
import { authenticateToken } from "../domain/credentials.js";
import { createBoardApp } from "../http/app.js";
import { ensurePreviewBootstrap } from "./bootstrap.js";
import { readPreviewAuthConfig } from "./config.js";

const PREVIEW_TOKEN = `comt_${"a".repeat(64)}`;

describe("preview auth config", () => {
  it("accepts a valid bootstrap token", () => {
    const previous = process.env.COMITIA_BOOTSTRAP_TOKEN;
    process.env.COMITIA_BOOTSTRAP_TOKEN = PREVIEW_TOKEN;
    try {
      expect(readPreviewAuthConfig()).toEqual({
        enabled: true,
        bootstrapToken: PREVIEW_TOKEN,
        ownerDisplayName: "Preview",
        projectName: "preview",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COMITIA_BOOTSTRAP_TOKEN;
      } else {
        process.env.COMITIA_BOOTSTRAP_TOKEN = previous;
      }
    }
  });

  it("ignores malformed bootstrap tokens", () => {
    const previous = process.env.COMITIA_BOOTSTRAP_TOKEN;
    process.env.COMITIA_BOOTSTRAP_TOKEN = "not-a-token";
    try {
      expect(readPreviewAuthConfig().enabled).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.COMITIA_BOOTSTRAP_TOKEN;
      } else {
        process.env.COMITIA_BOOTSTRAP_TOKEN = previous;
      }
    }
  });
});

describe("preview auth bootstrap", () => {
  it("bootstraps an empty board with the configured token", async () => {
    await ensurePreviewBootstrap(db, {
      enabled: true,
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
