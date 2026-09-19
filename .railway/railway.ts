import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  service,
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
 */
// Singapore. https://docs.railway.com/deployments/regions#region-options
const ASIA_REGION = "asia-southeast1-eqsg3a";

export default defineRailway(() => {
  const db = postgres("Postgres", { region: ASIA_REGION });

  const board = service("board", {
    source: github("hskksk/comitia", {
      branch: "main",
      // Wait for CI: GitHub Actions on push must pass before deploy.
      checkSuites: true,
    }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      // Redeploy only when board, web, shared, or root build inputs change.
      watchPatterns: [
        "packages/board/**",
        "packages/web/**",
        "packages/shared/**",
        "Dockerfile",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.base.json",
        "scripts/**",
      ],
    },
    healthcheck: "/healthz",
    healthcheckTimeout: 300,
    // Replicas stay at 1 (in-process tick loop + WS relay); region only.
    replicas: { [ASIA_REGION]: 1 },
    deploy: {
      // Serverless (formerly App Sleeping). https://docs.railway.com/deployments/serverless
      sleepApplication: true,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    env: {
      // Private plugin URL. Public DATABASE_URL would miss the IPv6-only
      // private network and stall before listen / healthcheck.
      DATABASE_URL: db.env.DATABASE_URL,
      // Railway healthchecks probe over IPv6. 0.0.0.0 is IPv4-only.
      HOST: "::",
      // Networking で付与された公開ドメイン（Generate Domain / カスタムドメイン）。
      BOARD_PUBLIC_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      GITHUB_APP_ID: preserve(),
      GITHUB_APP_PRIVATE_KEY: preserve(),
      GITHUB_APP_SLUG: preserve(),
      GITHUB_CLIENT_ID: preserve(),
      GITHUB_CLIENT_SECRET: preserve(),
      GITHUB_WEBHOOK_SECRET: preserve(),
    },
  });

  return project("comitia", {
    resources: [db, board],
  });
});
