# Railway IaC - Serverless Architecture

Project graph lives in `railway.ts`. [Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code) is the replacement for deprecated `railway.toml` Config as Code.

## Architecture

This project uses Railway Functions (Serverless) architecture instead of traditional services.

- **HTTP Handler**: `packages/board/dist/http/handler.default` - Processes all incoming HTTP requests
- **Background Tasks**: Triggered via scheduled cron endpoints that call background job handlers

## Setup

```bash
railway login
railway link
railway config plan
railway config apply
```

## Environment Variables

When deploying, ensure these variables are set:

- `CRON_SECRET`: Secret token for authenticating cron job requests
- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`: GitHub App configuration
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`: GitHub OAuth configuration

## Background Tasks

Background tasks (scheduler, health checks, mailbox flushing) are implemented as HTTP endpoints that must be called via external cron service:

- `POST /cron/tick`: Main periodic tick (recommended: every 15 seconds)
- `POST /cron/health-check`: Connection health monitoring (recommended: every 60 seconds)
- `POST /cron/flush-mailbox`: Process queued messages (recommended: every 30 seconds)

Each endpoint requires `x-cron-secret` header matching the `CRON_SECRET` environment variable.

### Setting up External Cron

Use a cron service like:
- [EasyCron](https://www.easycron.com/) - Free tier available
- [Railway Cron Jobs](https://docs.railway.com/guides/cron-jobs) (if available in your Railway tier)
- [Cronitor](https://cronitor.io/)

Human-facing deploy steps: [docs/ops/railway.md](../docs/ops/railway.md).
