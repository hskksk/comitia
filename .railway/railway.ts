import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  function as railwayFunction,
} from "railway/iac";

/**
 * Railway Infrastructure as Code (replaces deprecated railway.toml).
 *
 * Apply from a linked project:
 *   railway config plan
 *   railway config apply
 *
 * Config as Code (`railway.toml` / `railway.json`) cannot manage the same
 * service. That file is removed from this repo on purpose.
 *
 * Migrated to Serverless (Railway Functions) architecture.
 * Background processing handled through scheduled HTTP requests.
 */
export default defineRailway(() => {
  const db = postgres("Postgres");

  const board = railwayFunction("board", {
    source: github("hskksk/comitia", {
      branch: "main",
      // Wait for CI: GitHub Actions on push must pass before deploy.
      checkSuites: true,
    }),
    runtime: "node",
    handler: "packages/board/dist/http/handler.default",
    // Redeploy only when board, web, shared, or root build inputs change.
    watchPatterns: [
      "packages/board/**",
      "packages/web/**",
      "packages/shared/**",
      ".railway/**",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.base.json",
      "scripts/**",
    ],
    buildCommand: "pnpm install --frozen-lockfile && pnpm build",
    environment: {
      // Private plugin URL. Public DATABASE_URL would miss the IPv6-only
      // private network and stall before listen / healthcheck.
      DATABASE_URL: db.env.DATABASE_URL,
      // Networking で付与された公開ドメイン（Generate Domain / カスタムドメイン）。
      BOARD_PUBLIC_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      GITHUB_APP_ID: preserve(),
      GITHUB_APP_PRIVATE_KEY: preserve(),
      GITHUB_APP_SLUG: preserve(),
      GITHUB_CLIENT_ID: preserve(),
      GITHUB_CLIENT_SECRET: preserve(),
      GITHUB_WEBHOOK_SECRET: preserve(),
      // Serverless function configuration
      IS_SERVERLESS: "true",
      // Cron job authentication
      CRON_SECRET: preserve(),
      // Node.js configuration
      NODE_ENV: "production",
    },
  });

  return project("comitia", {
    resources: [db, board],
  });
});
